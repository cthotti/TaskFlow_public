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
  date?: string; // "YYYY-MM-DD"
};

type DateInfo = { date: string };

// small debounce helper for saving edits
function debounce<T extends (...args: any[]) => void>(fn: T, ms = 350) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export default function TodoList() {
  // fetchVersion prevents stale GET results from overwriting newer state
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
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  };

  const parseYMD = (s?: string): Date | null => {
    if (!s) return null;
    const parts = s.split("-");
    if (parts.length !== 3) return null;
    const [y, m, d] = parts.map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  };

  // ---------- fetchTasks ----------
  const fetchTasks = async () => {
    const ticket = ++fetchVersion.current;
    try {
      const res = await fetch("/api/tasks", { cache: "no-store" });
      if (!res.ok) throw new Error(`/api/tasks returned ${res.status}`);
      const data = await res.json();

      // If server already returned buckets, prefer them (support multiple key names)
      const directToday = (data as any).today ?? (data as any).todayTasks;
      const directCarry = (data as any).carryOver ?? (data as any).carryOverTasks;
      const directCompleted = (data as any).completed ?? (data as any).completedTasks;
      if (Array.isArray(directToday) || Array.isArray(directCarry) || Array.isArray(directCompleted)) {
        if (ticket !== fetchVersion.current) return;
        setTodayTasks(Array.isArray(directToday) ? directToday : []);
        setCarryOverTasks(Array.isArray(directCarry) ? directCarry : []);
        setCompletedTasks(Array.isArray(directCompleted) ? directCompleted : []);
        return;
      }

      // Otherwise try to extract a flat array and categorize locally
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
          description: t.description ?? t.desc ?? "",
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

      if (ticket !== fetchVersion.current) return; // ignore stale
      setTodayTasks(today);
      setCarryOverTasks(carry);
      setCompletedTasks(completed);
    } catch (err) {
      console.error("fetchTasks failed:", err);
      // DO NOT clear lists on transient error (preserve UI)
    }
  };

  // ---------- fetchDate ----------
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
      // ignore and fallback to client
    }
    setDateInfo({ date: formatLocalDate(new Date()) });
  };

  const formatLocalDate = (d: Date) =>
    d.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  // ---------- addTask (create) ----------
  const addTask = async () => {
    if (!newTask?.trim() || !dueTime) return;
    try {
      const payload = {
        text: newTask.trim(),
        due: dueTime,
        description: newDescription,
        date: localISODate(),
        carryOver: false, // new tasks should appear in Today
      };

      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("POST /api/tasks failed " + res.status);

      const created = await res.json().catch(() => null);
      const serverTask: any = created?.task ?? created ?? {};
      const saved: Task = {
        ...payload,
        ...serverTask,
        _id: serverTask._id ?? serverTask.id ?? `temp-${Date.now()}`,
      };

      // optimistic local append using server id if available
      setTodayTasks(prev => {
        const updated = [...prev, saved];
        return updated.sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""));
      });

      // gentle re-sync shortly after (protected by fetchVersion)
      setTimeout(() => fetchTasks(), 300);

      // clear form
      setNewTask("");
      setNewDescription("");
      setDueTime("");
      setShowForm(false);
    } catch (err) {
      console.error("addTask failed:", err);
    }
  };

  // ---------- delete ----------
  const deleteTask = async (id?: string) => {
    if (!id) return;
    try {
      await fetch(`/api/tasks/${id}`, { method: "DELETE" });
      setTodayTasks(prev => prev.filter(t => t._id !== id));
      setCarryOverTasks(prev => prev.filter(t => t._id !== id));
      setCompletedTasks(prev => prev.filter(t => t._id !== id));
    } catch (err) {
      console.error("deleteTask failed:", err);
    }
  };

  // ---------- markComplete ----------
  const markComplete = async (id?: string) => {
    if (!id) return;
    // optimistic update
    const found = todayTasks.find(t => t._id === id) || carryOverTasks.find(t => t._id === id);
    if (found) {
      setTodayTasks(prev => prev.filter(t => t._id !== id));
      setCarryOverTasks(prev => prev.filter(t => t._id !== id));
      setCompletedTasks(prev => [{ ...found, completed: true, carryOver: false }, ...prev]);
    }

    try {
      const res = await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: true, carryOver: false }),
      });
      if (!res.ok) {
        console.warn("markComplete patch failed", res.status);
        fetchTasks();
        return;
      }
      const data = await res.json().catch(() => null);
      const updated = data?.task ?? null;
      if (updated) {
        setCompletedTasks(prev => {
          const replaced = prev.filter(p => p._id !== id);
          return [updated, ...replaced];
        });
      }
    } catch (err) {
      console.error("markComplete failed:", err);
      fetchTasks();
    }
  };

  // ---------- addToToday (carry -> today) ----------
  const addToToday = async (id?: string) => {
    if (!id) return;
    const today = localISODate();
    try {
      const res = await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ carryOver: false, date: today }),
      });
      if (!res.ok) throw new Error("PATCH addToToday failed " + res.status);
      const data = await res.json().catch(() => null);
      const updated: Task | null = data?.task ?? null;

      // remove from carry locally
      setCarryOverTasks(prev => prev.filter(t => t._id !== id));
      if (updated) {
        setTodayTasks(prev => {
          const next = [...prev, updated];
          return next.sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""));
        });
      } else {
        fetchTasks();
      }
    } catch (err) {
      console.error("addToToday failed:", err);
      fetchTasks();
    }
  };

  // ---------- move local order ----------
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const formatTime = (time?: string) => {
    if (!time) return "";
    const [hhStr, mmStr] = time.split(":");
    const hh = Number(hhStr);
    const mm = Number(mmStr ?? 0);
    const hh12 = hh % 12 || 12;
    const ampm = hh >= 12 ? "PM" : "AM";
    return `${hh12}:${String(mm).padStart(2, "0")} ${ampm}`;
  };

  // ---------- renderTask (compact, dark minimal card) ----------
  const renderTask = (
    task: Task,
    idx: number,
    arr: Task[],
    setArr: (v: Task[]) => void,
    extras?: React.ReactNode
  ) => {
    // monochrome default card bg (server color may override if present)
    const bg = task.color ?? "#1E1E1E";

    // debounced save to server when editing fields
    const saveTask = debounce(async (updatedTask: Task) => {
      if (!updatedTask._id || String(updatedTask._id).startsWith("temp-")) return;
      try {
        await fetch(`/api/tasks/${updatedTask._id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: updatedTask.text,
            description: updatedTask.description,
            due: updatedTask.due,
            date: updatedTask.date,
            carryOver: updatedTask.carryOver,
            completed: updatedTask.completed,
            color: updatedTask.color,
          }),
        });
      } catch (err) {
        console.error("saveTask failed:", err);
      }
    }, 450);

    const updateField = (field: keyof Task, value: any) => {
      const updatedList = arr.map((item, i) => (i === idx ? { ...item, [field]: value } : item));
      setArr(updatedList);
      const updatedTask = updatedList[idx];
      // Only attempt save for real server ids (not temporary)
      if (updatedTask && updatedTask._id && !String(updatedTask._id).startsWith("temp-")) {
        saveTask(updatedTask);
      }
    };

    const handleAddRow = () => {
      const temp: Task = {
        _id: `temp-${Date.now()}`,
        text: "",
        description: "",
        due: "",
        color: pastelColors[Math.floor(Math.random() * pastelColors.length)],
        completed: false,
        carryOver: false,
        date: localISODate(),
      };
      const newArr = [...arr.slice(0, idx + 1), temp, ...arr.slice(idx + 1)];
      setArr(newArr);
    };

    const key = (task as any)._id ?? `${task.text}-${idx}-${task.due ?? ""}`;

    return (
      <div
        key={key}
        className="flex justify-between items-start p-2 mb-2 rounded-md border border-gray-600 bg-[#1E1E1E] w-full"
        style={{ backgroundColor: bg, color: "#E6E6E6" }}
      >
        <div className="flex-1 space-y-1">
          <div className="flex items-center justify-between gap-3">
            <input
              type="text"
              value={task.text}
              onChange={(e) => updateField("text", e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
                  e.preventDefault();
                  handleAddRow();
                }
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                }
              }}
              className="font-medium text-sm text-gray-100 bg-transparent outline-none flex-1"
              placeholder="Task name"
            />

            {task.due && (
              <span className="ml-2 text-[12px] text-gray-400 whitespace-nowrap">{formatTime(task.due)}</span>
            )}
          </div>

          <textarea
            value={task.description ?? ""}
            onChange={(e) => updateField("description", e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.shiftKey) return;
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
              }
            }}
            className="text-xs text-gray-300 whitespace-pre-line w-full bg-transparent outline-none"
            placeholder="More info..."
            rows={1}
          />
        </div>

        <div className="flex items-center gap-2 ml-2">
          <button onClick={() => moveTask(setArr, arr, idx, "up")} className="text-base text-gray-400 hover:text-gray-200" aria-label="up">↑</button>
          <button onClick={() => moveTask(setArr, arr, idx, "down")} className="text-base text-gray-400 hover:text-gray-200" aria-label="down">↓</button>
          {extras}
        </div>
      </div>
    );
  };

  // ---------- final render (grid with three columns) ----------
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
                <button onClick={() => addToToday(t._id)} className="text-xs text-gray-200 border border-gray-500 rounded px-2 py-1 hover:bg-gray-700">Add</button>
                <button onClick={() => deleteTask(t._id)} className="text-lg text-gray-400 hover:text-red-500">×</button>
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
                <input type="checkbox" checked={!!t.completed} onChange={() => markComplete(t._id)} aria-label="complete" className="w-4 h-4 ml-1 mr-1" />
                <button onClick={() => deleteTask(t._id)} className="text-sm text-gray-500">×</button>
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
              <button onClick={() => deleteTask(t._id)} className="text-lg text-gray-400 hover:text-red-500">×</button>
            ))
          )
        )}
      </section>
    </div>
  );
}
