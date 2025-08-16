// src/components/TodoList.tsx
"use client";
import React, { useEffect, useState } from "react";
import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"], weight: ["400", "600", "700"] });

type Task = {
  _id?: string;
  text: string;
  due?: string;
  description?: string;
  color?: string;
  completed?: boolean;
  carryOver?: boolean;
  date?: string;          // "YYYY-MM-DD"
};

type DateInfo = { date: string };

export default function TodoList() {
  const fetchVersion = React.useRef(0);
  const [todayTasks, setTodayTasks] = useState<Task[]>([]);
  const [carryOverTasks, setCarryOverTasks] = useState<Task[]>([]);
  const [completedTasks, setCompletedTasks] = useState<Task[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [newDescription, setNewDescription] = useState("");
  const [newTask, setNewTask] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [dateInfo, setDateInfo] = useState<DateInfo>({ date: "" });

  const pastelColors = [
    "#FFDEE9", "#B5FFFC", "#C9FFBF", "#FFD6A5", "#FEC5E5",
    "#D5AAFF", "#FFFACD", "#C1F0F6", "#FFB3BA", "#BAFFC9"
  ];


  const localISODate = (): string => {
    const d = new Date();
    d.setMinutes(d.getMinutes()-d.getTimezoneOffset());
    return d.toISOString().slice(0,10);
  };

  const parseYMD = (s?: string): Date | null => {
    if (!s) return null;
    const parts = s.split("-");
    if (parts.length !== 3) return null;
    const [y, m, d] = parts.map(Number);
    if (!y || !m || !d) return null;
    // Construct at local midnight (avoids UTC shift)
    return new Date(y, m - 1, d);
  };

  // --- fetchTasks: robust categorization ---

const fetchTasks = async () => {
  const ticket = ++fetchVersion.current; // only last response may win
  try {
    const res = await fetch("/api/tasks", { cache: "no-store" });
    if (!res.ok) throw new Error(`GET /api/tasks ${res.status}`);
    const data = await res.json();

    // If API already returns buckets:
    if (
      Array.isArray((data as any).todayTasks) ||
      Array.isArray((data as any).carryOverTasks) ||
      Array.isArray((data as any).completedTasks) ||
      Array.isArray((data as any).today) ||
      Array.isArray((data as any).carryOver) ||
      Array.isArray((data as any).completed)
    ) {
      if (ticket !== fetchVersion.current) return;
      setTodayTasks((data as any).todayTasks ?? (data as any).today ?? []);
      setCarryOverTasks((data as any).carryOverTasks ?? (data as any).carryOver ?? []);
      setCompletedTasks((data as any).completedTasks ?? (data as any).completed ?? []);
      return;
    }

    // Normalize a flat array shape
    let all: any[] = [];
    if (Array.isArray(data)) all = data;
    else if (Array.isArray((data as any).tasks)) all = (data as any).tasks;
    else {
      const maybe = Object.values(data).find(Array.isArray) as any[] | undefined;
      all = maybe ?? [];
    }

    const todayStr = localISODate();
    const today: Task[] = [];
    const carry: Task[] = [];
    const completed: Task[] = [];

    all.forEach((t: any) => {
      const task: Task = {
        _id: t._id ?? t.id,
        text: t.text ?? "",
        due: t.due ?? t.time,
        description: t.description ?? t.desc,
        color: t.color,
        completed: !!t.completed,
        carryOver: !!t.carryOver,
        date: t.date,
      };

      if (task.completed) { completed.push(task); return; }
      if (task.carryOver) { carry.push(task); return; }

      const taskDate = parseYMD(task.date);
      const todayDate = parseYMD(todayStr);
      const isPast = !!taskDate && !!todayDate && taskDate.getTime() < todayDate.getTime();

      if (isPast) carry.push({ ...task, carryOver: true });
      else if (task.date === todayStr || !task.date) today.push({ ...task, date: todayStr });
      else carry.push({ ...task, carryOver: true });
    });

    today.sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""));

    if (ticket !== fetchVersion.current) return; // stale response, ignore
    setTodayTasks(today);
    setCarryOverTasks(carry);
    setCompletedTasks(completed);
  } catch (e) {
    console.error("fetchTasks failed:", e);
    // IMPORTANT: don't nuke existing lists on transient error
  }
};

  // Try python backend /date, fallback to client date
  const fetchDate = async () => {
    try {
      const base = process.env.NEXT_PUBLIC_API_URL;
      if (base) {
        const res = await fetch(`${base}/date`, { cache: "no-store" });
        if (res.ok) {
          const d = await res.json();
          setDateInfo({ date: d.date ?? formatLocalDate(new Date()) });
          return;
        }
      }
    } catch {
      // ignore
    }
    setDateInfo({ date: formatLocalDate(new Date()) });
  };

  const formatLocalDate = (d: Date) =>
    d.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  // --- addTask: send date so it stays in Today on reload ---
  const addTask = async () => {
    if (!newTask || !dueTime) return;
  try {
    const payload = {
      text: newTask,
      due: dueTime,
      description: newDescription,
      date: localISODate(),
      carryOver: false, // goes into Today
    };

    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("add task failed " + res.status);

    const created = await res.json().catch(() => null);
    const serverTask: any = created?.task ?? created ?? {};
    const saved: Task = {
      ...payload,
      ...serverTask,
      _id: serverTask._id ?? serverTask.id ?? `temp-${Date.now()}`,
      carryOver: false,
      date: payload.date,
    };

    // Optimistic append with the server's id when available
    setTodayTasks(prev =>
      [...prev, saved].sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""))
    );

    // Optional: gentle re-sync shortly after (won't clobber due to version guard)
    setTimeout(() => fetchTasks(), 250);

    setNewTask("");
    setNewDescription("");
    setDueTime("");
    setShowForm(false);
  } catch (err) {
    console.error("Failed to add task:", err);
  }
  };

  // --- deleteTask safely updates only lists that contain the id ---
  const deleteTask = async (id: string) => {
    try {
      const res = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
      if (!res.ok) console.warn("delete returned non-ok", res.status);
      setTodayTasks(prev => prev.filter(t => t._id !== id));
      setCarryOverTasks(prev => prev.filter(t => t._id !== id));
      setCompletedTasks(prev => prev.filter(t => t._id !== id));
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  // --- markComplete: optimistic UI update (move to completed) ---
  const markComplete = async (id: string) => {
    // optimistic: remove locally and move to completed
    const found = todayTasks.find(t => t._id === id);
    if (found) {
      setTodayTasks(prev => prev.filter(t => t._id !== id));
      setCompletedTasks(prev => [ { ...found, description: undefined, completed: true, carryOver: false}, ...prev ]);
    }

    try {
      const res = await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: true, carryOver: false }),
      });
      if (!res.ok) {
        console.warn("markComplete patch failed", res.status);
        // fallback: refetch lists to re-sync
        fetchTasks();
      } else {
        // try to update the server-returned task into completed list if provided
        const data = await res.json().catch(() => null);
        const updated = data?.task ?? null;
        if (updated) {
          setCompletedTasks(prev => {
            // replace the optimistic entry with server's updated one (match by id)
            const replaced = prev.filter(p => p._id !== id);
            return [updated, ...replaced];
          });
        }
      }
    } catch (err) {
      console.error("Mark complete failed:", err);
      fetchTasks();
    }
  };

  // --- addToToday (carry -> today): patch date & carryOver false and update local lists ---
  const addToToday = async (id: string) => {
    const todayStr = localISODate();
    try {
      const res = await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ carryOver: false, date: todayStr }),
      });
      if (!res.ok) throw new Error("patch failed " + res.status);
      const data = await res.json().catch(() => null);
      const updated: Task = data?.task ?? null;

      // remove from carryOver locally
      setCarryOverTasks(prev => prev.filter(t => t._id !== id));
      if (updated) {
        setTodayTasks(prev => {
          const next = [...prev, updated];
          return next.sort((a,b)=> (a.due ?? "").localeCompare(b.due ?? ""));
        });
      } else {
        // fallback: re-fetch
        fetchTasks();
      }
    } catch (err) {
      console.error("Add to today failed:", err);
      fetchTasks();
    }
  };

  // local up/down movement
  const moveTask = (setter: (arr: Task[]) => void, arr: Task[], i: number, dir: "up" | "down") => {
    const updated = [...arr];
    const j = dir === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= arr.length) return;
    [updated[i], updated[j]] = [updated[j], updated[i]];
    setter(updated);
  };

  useEffect(() => {
    fetchTasks();
    fetchDate();
  }, []);

  const formatTime = (time?: string) => {
    if (!time) return "";
    const [hh, mm] = time.split(":").map(Number);
    const hh12 = hh % 12 || 12;
    const ampm = hh >= 12 ? "PM" : "AM";
    return `${hh12}:${mm.toString().padStart(2, "0")} ${ampm}`;
  };

  // render a compact task card (smaller)
const renderTask = (
  task: Task,
  idx: number,
  arr: Task[],
  setArr: any,
  extras?: React.ReactNode
) => {
  const bg = task.color ?? pastelColors[(task.text?.length ?? 0) % pastelColors.length];

  // Function to add a new blank task row (✅ no prev updater)
  const handleAddNewTask = () => {
    const newTask: Task = {
      _id: `temp-${Date.now()}`,
      text: "",
      description: "",
      due: "",
      color: pastelColors[Math.floor(Math.random() * pastelColors.length)],
      completed: false,
      carryOver: true,
      date: localISODate(),
    };
    const newArr = [...arr.slice(0, idx + 1), newTask, ...arr.slice(idx + 1)];
    setArr(newArr);
  };

  // Function to submit the task
  const handleSubmitTask = () => {
    // TODO: Replace with your actual save/submit logic
    console.log("Submitting task:", task);
  };

  // Helper to update a single field
  const updateField = (field: keyof Task, value: any) => {
    const updated = arr.map((item, i) =>
      i === idx ? { ...item, [field]: value } : item
    );
    setArr(updated);
  };

  return (
  <div
    key={(task as any)._id ?? (task as any).id ?? `${task.text}-${idx}`}
    className="flex justify-between items-start p-2 mb-2 rounded-md border border-gray-600 bg-[#1E1E1E] w-full"
  >
    <div className="flex-1 space-y-1">
      {/* Task Name Input + Due Date inline */}
      <div className="flex items-center justify-between">
        <input
          type="text"
          value={task.text}
          onChange={(e) => updateField("text", e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "+" && e.code === "Enter") {
              e.preventDefault();
              handleAddNewTask();
            } else if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmitTask();
            }
          }}
          className="font-medium text-sm text-gray-100 bg-transparent outline-none flex-1"
          placeholder="Task name"
        />

        {task.due && (
          <span className="ml-2 text-[11px] text-gray-400 whitespace-nowrap">
            {formatTime(task.due)}
          </span>
        )}
      </div>

      {/* ✅ Compact Description */}
      <textarea
        value={task.description || ""}
        onChange={(e) => updateField("description", e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.shiftKey) return;
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSubmitTask();
          }
        }}
        className="text-xs text-gray-300 whitespace-pre-line w-full bg-transparent outline-none"
        placeholder="More info..."
        rows={1}
      />
    </div>

    {/* Controls */}
    <div className="flex items-center gap-1 ml-1">
      <button
        onClick={() => moveTask(setArr, arr, idx, "up")}
        className="text-sm text-gray-400 hover:text-gray-200"
        aria-label="up"
      >
        ↑
      </button>
      <button
        onClick={() => moveTask(setArr, arr, idx, "down")}
        className="text-sm text-gray-400 hover:text-gray-200"
        aria-label="down"
      >
        ↓
      </button>
      {extras}
    </div>
  </div>
);
};


// Outer grid — NO black background wrapper
return (
  <div className={`${inter.className} grid grid-cols-1 md:grid-cols-3 gap-6 p-6 items-start`}>
    
    {/* Carry Over */}
    <section>
      <h3 className="text-md font-semibold text-white border border-gray-600 rounded-md py-2 px-3 text-center mb-3">
        Carry Over
      </h3>
      {(carryOverTasks ?? []).length === 0 ? (
        <p className="text-sm text-gray-500 text-center">No carry-over tasks</p>
      ) : (
        carryOverTasks.map((t, i) =>
          renderTask(t, i, carryOverTasks, setCarryOverTasks, (
            <>
              <button onClick={() => addToToday(t._id!)} className="text-xs text-gray-200 border border-gray-500 rounded px-2 py-1 hover:bg-gray-700">
                Add
              </button>
              <button onClick={() => deleteTask(t._id!)} className="text-lg text-gray-400 hover:text-red-500">
                ×
              </button>
            </>
          ))
        )
      )}
    </section>

    {/* Today */}
    <main>
      <h3 className="text-md font-semibold text-white border border-gray-600 rounded-md py-2 px-3 text-center mb-3 flex items-center justify-between">
        <span>{dateInfo.date || formatLocalDate(new Date())}</span>
        <button onClick={() => setShowForm(s => !s)} className="text-xl text-gray-300 hover:text-white">+</button>
      </h3>

      {showForm && (
        <div className="mb-3 space-y-2">
          <input
            type="text"
            placeholder="Task"
            value={newTask}
            onChange={e => setNewTask(e.target.value)}
            className="w-full p-2 border border-gray-600 rounded bg-[#1E1E1E] text-gray-100"
          />
          <textarea
            placeholder="More Info"
            value={newDescription}
            onChange={e => setNewDescription(e.target.value)}
            className="w-full p-2 border border-gray-600 rounded bg-[#1E1E1E] text-gray-300"
            rows={2}
          />
          <input
            type="time"
            value={dueTime}
            onChange={e => setDueTime(e.target.value)}
            className="w-full p-2 border border-gray-600 rounded bg-[#1E1E1E] text-gray-100"
          />
          <button onClick={addTask} className="w-full bg-gray-700 text-gray-100 p-2 rounded-md hover:bg-gray-600">Add Task</button>
        </div>
      )}

      {(todayTasks ?? []).length === 0 ? (
        <p className="text-sm text-gray-500">No tasks for today</p>
      ) : (
        todayTasks.map((t, i) =>
          renderTask(t, i, todayTasks, setTodayTasks, (
            <>
              <input type="checkbox" onChange={() => markComplete(t._id!)} aria-label="complete" />
              <button onClick={() => deleteTask(t._id!)} className="text-sm text-gray-500">×</button>
            </>
          ))
        )
      )}
    </main>

    {/* Completed */}
    <section>
      <h3 className="text-md font-semibold text-white border border-gray-600 rounded-md py-2 px-3 text-center mb-3">
        Completed
      </h3>
      {(completedTasks ?? []).length === 0 ? (
        <p className="text-sm text-gray-500 text-center">No completed tasks</p>
      ) : (
        completedTasks.map((t, i) =>
          renderTask(t, i, completedTasks, setCompletedTasks, (
            <button onClick={() => deleteTask(t._id!)} className="text-lg text-gray-400 hover:text-red-500">×</button>
          ))
        )
      )}
    </section>
  </div>
);

}