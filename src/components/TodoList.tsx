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
  const [todayTasks, setTodayTasks] = useState<Task[]>([]);
  const [carryOverTasks, setCarryOverTasks] = useState<Task[]>([]);
  const [completedTasks, setCompletedTasks] = useState<Task[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [newDescription, setNewDescription] = useState("");
  const [newTask, setNewTask] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [dateInfo, setDateInfo] = useState<DateInfo>({ date: "" });

  const pastelColors = [
    "#8C8C8C"
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
  try {
      const res = await fetch("/api/tasks");
      if (!res.ok) {
        console.warn("fetch /api/tasks returned non-ok:", res.status);
        return;
      }
      const data = await res.json();

      // Accept many shapes: { today:[], carryOver:[], completed:[] }
      // or { tasks: [...] } or plain array.

      let allTasks: Task[] = [];

      if (Array.isArray(data)) {
        allTasks = data;
      } else if (Array.isArray(data.tasks)) {
        allTasks = data.tasks;
      } else {
        // If API already splits lists, use them
        if (Array.isArray(data.today) || Array.isArray(data.carryOver) || Array.isArray(data.completed)) {
          setTodayTasks(Array.isArray(data.today) ? data.today : []);
          setCarryOverTasks(Array.isArray(data.carryOver) ? data.carryOver : []);
          setCompletedTasks(Array.isArray(data.completed) ? data.completed : []);
          return;
        }
        // fallback: try any other top-level arrays (robust)
        const maybe = Object.values(data).find(v => Array.isArray(v)) as any;
        if (Array.isArray(maybe)) {
          allTasks = maybe;
        } else {
          // as last resort, treat data as empty
          allTasks = [];
        }
      }

      // categorize by flags/date
      const todayStr = localISODate();
      const today: Task[] = [];
      const carry: Task[] = [];
      const completed: Task[] = [];

    allTasks.forEach((t: any) => {
        const task: Task = {
            _id: t._id ?? t.id,
            text: t.text ?? "",
            due: t.due,
            description: t.description,
            color: t.color,
            completed: !!t.completed,
            carryOver: !!t.carryOver,
            date: t.date,
        };

        if (task.completed) {
            completed.push(task);
            return;
        }

        // If DB says carryOver = true, always trust that
        if (task.carryOver) {
            carry.push(task);
            return;
        }

        const taskDate = parseYMD(task.date);
        const todayDate = parseYMD(todayStr);
        const isPastDate = Boolean(taskDate && todayDate && taskDate.getTime() < todayDate.getTime());

        if (isPastDate) {
            carry.push({ ...task, carryOver: true });
        } else if (task.date === todayStr) {
            today.push(task);
        } else if (!task.date) {
            today.push({ ...task, date: todayStr });
        } else {
            carry.push({ ...task, carryOver: true });
        }
    });


      // sort today's tasks by due
      const sortByDue = (arr: Task[]) => arr.sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""));

      setTodayTasks(sortByDue(today));
      setCarryOverTasks(carry);
      setCompletedTasks(completed);
    } catch (err) {
      console.error("Failed to fetch tasks:", err);
      setTodayTasks([]);
      setCarryOverTasks([]);
      setCompletedTasks([]);
    }
};

  // Try python backend /date, fallback to client date
  const fetchDate = async () => {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/date`);
    const data = await res.json();
    setDateInfo(data)
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
        date: localISODate(),    // IMPORTANT: ensure server stores date
        carryOver: false
      };
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("add task failed " + res.status);
      const data = await res.json();
      const newT: Task = data.task ?? data;
      setTodayTasks(prev => {
        const updated = [...prev, newT];
        return updated.sort((a,b) => (a.due ?? "").localeCompare(b.due ?? ""));
      });
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
      carryOver: false,
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
      key={task._id ?? `${task.text}-${idx}`}
      className="flex justify-between items-start p-2 mb-2 rounded-md border border-gray-200 shadow-sm w-full"
      style={{ backgroundColor: bg, color: "black" }}
    >
      <div className="flex-1 space-y-1">
        {/* Task Name Input */}
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
          className="font-medium text-sm text-black w-full bg-transparent outline-none"
          placeholder="Task name"
        />

        {/* ✅ Description textarea with Shift+Enter for new line */}
        <textarea
          value={task.description || ""}
          onChange={(e) => updateField("description", e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.shiftKey) {
              // Allow newline
              return;
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmitTask();
            }
          }}
          className="text-xs text-black whitespace-pre-line w-full bg-transparent outline-none"
          placeholder="More info..."
          rows={1}
        />

        {task.due && (
          <div className="text-[11px] text-gray-700">
            Due: {formatTime(task.due)}
          </div>
        )}
      </div>

      <div className="flex items-center gap-1 ml-1">
        <button
          onClick={() => moveTask(setArr, arr, idx, "up")}
          className="text-sm text-gray-700"
          aria-label="up"
        >
          ↑
        </button>
        <button
          onClick={() => moveTask(setArr, arr, idx, "down")}
          className="text-sm text-gray-700"
          aria-label="down"
        >
          ↓
        </button>
        {extras}
      </div>
    </div>
  );
};




  // outer grid - NOTE: items-start so column heights are independent.
    return (
    <div className={`${inter.className} grid grid-cols-1 md:grid-cols-3 gap-6 p-6 items-start`}>
        
        {/* Carry Over */}
        <section className="bg-white rounded-lg p-6 border border-gray-300 shadow-md">
        <h3 className="text-lg font-bold mb-4 text-center text-black">Carry Over</h3>
        {(carryOverTasks ?? []).length === 0 ? (
            <p className="text-sm text-gray-500 text-center">No carry-over tasks</p>
        ) : (
            carryOverTasks.map((t, i) =>
            renderTask(t, i, carryOverTasks, setCarryOverTasks, (
                <>
                <button onClick={() => addToToday(t._id!)} className="bg-green-600 text-white px-2 py-1 rounded-md text-sm">Add</button>
                <button onClick={() => deleteTask(t._id!)} className="text-lg text-red-600">×</button>
                </>
            ))
            )
        )}
        </section>

        {/* Today */}
        <main className="bg-white rounded-lg p-6 border border-gray-300 shadow-md">
        <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-black">{dateInfo.date || formatLocalDate(new Date())}</h2>
            <button onClick={() => setShowForm(s => !s)} className="text-3xl text-blue-600">+</button>
        </div>

        {showForm && (
            <div className="mb-3 space-y-2">
            <input
                type="text"
                placeholder="Task"
                value={newTask}
                onChange={e => setNewTask(e.target.value)}
                className="w-full p-2 border rounded bg-white text-black"
            />
            <textarea
                placeholder="More Info"
                value={newDescription}
                onChange={e => setNewDescription(e.target.value)}
                className="w-full p-2 border rounded bg-white text-black"
                rows={3}
            />
            <input
                type="time"
                value={dueTime}
                onChange={e => setDueTime(e.target.value)}
                className="w-full p-2 border rounded bg-white text-black"
            />
            <button onClick={addTask} className="w-full bg-blue-600 text-white p-2 rounded-md">Add Task</button>
            </div>
        )}

        {(todayTasks ?? []).length === 0 ? (
            <p className="text-sm text-gray-500">No tasks for today</p>
        ) : (
            todayTasks.map((t, i) =>
            renderTask(t, i, todayTasks, setTodayTasks, (
                <>
                <input type="checkbox" onChange={() => markComplete(t._id!)} aria-label="complete" />
                <button onClick={() => deleteTask(t._id!)} className="text-lg text-red-600">×</button>
                </>
            ))
            )
        )}
        </main>

        {/* Completed */}
        <section className="bg-white rounded-lg p-6 border border-gray-300 shadow-md">
        <h3 className="text-lg font-bold mb-4 text-center text-black">Completed</h3>
        {(completedTasks ?? []).length === 0 ? (
            <p className="text-sm text-gray-500 text-center">No completed tasks</p>
        ) : (
            completedTasks.map((t, i) =>
            renderTask(t, i, completedTasks, setCompletedTasks, (
                <button onClick={() => deleteTask(t._id!)} className="text-lg text-red-600">×</button>
            ))
            )
        )}
        </section>
    </div>
    );
}