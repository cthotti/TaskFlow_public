// src/components/TodoList.tsx
"use client";
import React, { useEffect, useState } from "react";
import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"], weight: ["400", "600", "700"] });

type Task = {
  _id?: string;
  text: string;
  due?: string;          // "HH:MM"
  description?: string;
  color?: string;
  completed?: boolean;
  carryOver?: boolean;
  date?: string;         // "YYYY-MM-DD"
  // optionally include createdAt or clientTempId if needed
  clientTempId?: string;
};

type DateInfo = { date: string };

// ---------- Utilities: local-ISO date + safe date parsing ----------
const localISODate = (): string => {
  // returns YYYY-MM-DD in local timezone
  const d = new Date();
  const tzOffsetMs = d.getTimezoneOffset() * 60000;
  return new Date(Date.now() - tzOffsetMs).toISOString().split("T")[0];
};

const parseYMD = (s?: string): Date | null => {
  if (!s) return null;
  const parts = s.split("-");
  if (parts.length !== 3) return null;
  const [y, m, d] = parts.map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
};

const isBeforeDay = (a?: string, b?: string) => {
  const da = parseYMD(a), db = parseYMD(b);
  if (!da || !db) return false;
  return da.getTime() < db.getTime();
};

// ---------- debounce (browser-safe typing) ----------
function debounce<T extends (...args: any[]) => void>(fn: T, ms = 300) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// ---------- Component ----------
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
    "#FFDEE9", "#B5FFFC", "#C9FFBF", "#FFD6A5", "#FEC5E5",
    "#D5AAFF", "#FFFACD", "#C1F0F6", "#FFB3BA", "#BAFFC9"
  ];

  const todayStr = () => localISODate();

  // ---------- fetchTasks ----------
  const fetchTasks = async () => {
    try {
      const res = await fetch("/api/tasks");
      if (!res.ok) {
        console.warn("fetch /api/tasks returned non-ok:", res.status);
        return;
      }
      const data = await res.json();

      let allTasks: Task[] = [];
      if (Array.isArray(data)) {
        allTasks = data;
      } else if (Array.isArray(data.tasks)) {
        allTasks = data.tasks;
      } else if (Array.isArray(data.today) || Array.isArray(data.carryOver) || Array.isArray(data.completed)) {
        setTodayTasks(Array.isArray(data.today) ? data.today : []);
        setCarryOverTasks(Array.isArray(data.carryOver) ? data.carryOver : []);
        setCompletedTasks(Array.isArray(data.completed) ? data.completed : []);
        return;
      } else {
        const maybe = Object.values(data).find(v => Array.isArray(v)) as any;
        allTasks = Array.isArray(maybe) ? maybe : [];
      }

      const todayIso = todayStr();
      const today: Task[] = [];
      const carry: Task[] = [];
      const completed: Task[] = [];

      allTasks.forEach((t: any) => {
        const task: Task = {
          _id: t._id ?? t.id,
          text: t.text ?? "",
          due: t.due,
          color: t.color,
          completed: !!t.completed,
          carryOver: !!t.carryOver,
          date: t.date,
          description: t.description,
        };

        if (task.completed) {
          completed.push(task);
          return;
        }

        const taskDate = task.date ? parseYMD(task.date) : null;
        const todayDate = parseYMD(todayIso);
        const isPastDate = taskDate && todayDate && taskDate.getTime() < todayDate.getTime();

        if (isPastDate) {
          carry.push({ ...task, carryOver: true });
        } else if (task.carryOver) {
          carry.push(task);
        } else if (task.date === todayIso) {
          today.push(task);
        } else if (!task.date) {
          today.push({ ...task, date: todayIso });
        } else {
          // future tasks keep in carry for now
          carry.push(task);
        }
      });

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

  // ---------- fetchDate (optional external) ----------
  const fetchDate = async () => {
    try {
      if (process.env.NEXT_PUBLIC_API_URL) {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/date`);
        if (res.ok) {
          const d = await res.json();
          setDateInfo({ date: d.date ?? new Date().toLocaleDateString() });
          return;
        }
      }
    } catch (_e) {
      // ignore
    }
    setDateInfo({ date: new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" }) });
  };

  // ---------- addTask (POST) ----------
const addTask = async () => {
  if (!newTask.trim()) return;
  try {
    const payload = {
      text: newTask,
      description: newTask, // <-- use same value for description
      due: dueTime || undefined,
      date: todayStr(),
      carryOver: false,
    };
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("add task failed " + res.status);
    const data = await res.json();
    const newT: Task = data.task ?? data;
    setTodayTasks((prev) => {
      const updated = [...prev, newT];
      return updated.sort((a, b) =>
        (a.due ?? "").localeCompare(b.due ?? "")
      );
    });
    setNewTask("");
    setDueTime("");
    setShowForm(false);
  } catch (err) {
    console.error("Failed to add task:", err);
  }
};


  // ---------- deleteTask ----------
  const deleteTask = async (id?: string, clientTempId?: string) => {
    try {
      if (id && !id.startsWith("temp-")) {
        const res = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
        if (!res.ok) console.warn("delete returned non-ok", res.status);
      }
      // optimistic local removal
      setTodayTasks(prev => prev.filter(t => t._id !== id && t.clientTempId !== clientTempId));
      setCarryOverTasks(prev => prev.filter(t => t._id !== id && t.clientTempId !== clientTempId));
      setCompletedTasks(prev => prev.filter(t => t._id !== id && t.clientTempId !== clientTempId));
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  // ---------- markComplete ----------
  const markComplete = async (id?: string, clientTempId?: string) => {
    // find in today first, fallback to carryOver
    const found = todayTasks.find(t => t._id === id || t.clientTempId === clientTempId) ||
                  carryOverTasks.find(t => t._id === id || t.clientTempId === clientTempId);
    if (found) {
      // optimistic
      setTodayTasks(prev => prev.filter(t => t._id !== id && t.clientTempId !== clientTempId));
      setCarryOverTasks(prev => prev.filter(t => t._id !== id && t.clientTempId !== clientTempId));
      setCompletedTasks(prev => [{ ...found, completed: true }, ...prev]);
    }

    try {
      if (id && !id.startsWith("temp-")) {
        const res = await fetch(`/api/tasks/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ completed: true }),
        });
        if (!res.ok) {
          console.warn("markComplete patch failed", res.status);
          fetchTasks();
        } else {
          const data = await res.json().catch(() => null);
          const updated = data?.task ?? null;
          if (updated) {
            setCompletedTasks(prev => {
              const filtered = prev.filter(p => p._id !== id);
              return [updated, ...filtered];
            });
          }
        }
      } else {
        // cannot PATCH a temp id — force a refetch to sync if desired
        fetchTasks();
      }
    } catch (err) {
      console.error("Mark complete failed:", err);
      fetchTasks();
    }
  };

  // ---------- addToToday ----------
  const addToToday = async (id?: string) => {
    if (!id) return;
    const today = todayStr();
    try {
      const res = await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ carryOver: false, date: today }),
      });
      if (!res.ok) throw new Error("patch failed " + res.status);
      const data = await res.json().catch(() => null);
      const updated: Task | null = data?.task ?? null;
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
      console.error("Add to today failed:", err);
      fetchTasks();
    }
  };

  // ---------- local reorder ----------
  const moveTask = (setter: React.Dispatch<React.SetStateAction<Task[]>>, arr: Task[], i: number, dir: "up" | "down") => {
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
    const [hhStr, mmStr] = time.split(":");
    const hh = Number(hhStr);
    const mm = Number(mmStr);
    const hh12 = hh % 12 || 12;
    const ampm = hh >= 12 ? "PM" : "AM";
    return `${hh12}:${String(mm).padStart(2, "0")} ${ampm}`;
  };

  // ---------- renderTask (compact) ----------
  const renderTask = (
    task: Task,
    idx: number,
    arr: Task[],
    setArr: React.Dispatch<React.SetStateAction<Task[]>>,
    extras?: React.ReactNode
  ) => {
    // use stable color: prefer explicit task.color, else hash of id or clientTempId
    const bg = task.color ?? pastelColors[(task._id?.length ?? task.clientTempId?.length ?? 0) % pastelColors.length];

    // save only if server id exists (not temp)
    const saveTask = debounce(async (updatedTask: Task) => {
      try {
        if (!updatedTask._id || String(updatedTask._id).startsWith("temp-")) return;
        await fetch(`/api/tasks/${updatedTask._id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updatedTask),
        });
      } catch (err) {
        console.error("Failed to save task:", err);
      }
    }, 450);

    const updateField = (field: keyof Task, value: any) => {
        const updatedTask = { ...task, [field]: value };
        const updatedList = arr.map((item, i) => (i === idx ? updatedTask : item));
        setArr(updatedList);

        // Immediately persist changes even for new temp tasks
        if (!updatedTask._id || String(updatedTask._id).startsWith("temp-")) {
            // If it's a temp task, create it instead of patching
            fetch("/api/tasks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updatedTask),
            })
            .then(res => res.json())
            .then(data => {
                // Replace temp task with server version
                const created = data.task ?? data;
                setArr(prev =>
                prev.map(t => (t.clientTempId === task.clientTempId ? created : t))
                );
            })
            .catch(err => console.error("Failed to create task:", err));
        } else {
            // Real ID → patch
            saveTask(updatedTask);
        }
        };


    const handleKeyDown = (e: React.KeyboardEvent, field: keyof Task) => {
      // Cmd/Ctrl+N -> new task
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        handleAddNewTask();
        return;
      }
      // Enter -> save
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        // use latest item from arr to ensure we don't save stale captured `task`
        const current = arr[idx];
        saveTask(current);
      }
      // Shift+Enter in description -> newline
      if (e.key === "Enter" && e.shiftKey && field === "description") {
        return;
      }
    };

    const handleAddNewTask = () => {
      const clientTempId = `temp-${Date.now()}`;
      const newTaskObj: Task = {
        clientTempId,
        text: "",
        description: "",
        due: "",
        color: pastelColors[Math.floor(Math.random() * pastelColors.length)],
        completed: false,
        carryOver: false,
        date: todayStr(),
      };
      const newArr = [...arr.slice(0, idx + 1), newTaskObj, ...arr.slice(idx + 1)];
      setArr(newArr);
    };

    const key = task._id ?? task.clientTempId ?? `${task.text}-${idx}`;

    return (
      <div
        key={key}
        className="flex justify-between items-center p-3 mb-3 rounded-md border border-gray-300 shadow-sm w-full"
        style={{ backgroundColor: bg, color: "black" }}
      >
        <div className="flex-1">
          <input
            type="text"
            value={task.text}
            onChange={(e) => updateField("text", e.target.value)}
            onKeyDown={(e) => handleKeyDown(e, "text")}
            className="font-semibold text-base text-black w-11/12 bg-transparent outline-none"
            placeholder="Task name"
            aria-label="Task name"
          />
          <textarea
            value={task.description || ""}
            onChange={(e) => updateField("description", e.target.value)}
            onKeyDown={(e) => handleKeyDown(e, "description")}
            className="text-sm mt-1 text-black whitespace-pre-line w-11/12 bg-transparent outline-none"
            placeholder="More info..."
            rows={2}
            aria-label="Task details"
          />
          {task.due && (
            <div className="text-xs mt-1 text-black">
              Due: {formatTime(task.due)}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 ml-2">
          <button onClick={() => moveTask(setArr, arr, idx, "up")} className="text-lg text-black" aria-label="move up">↑</button>
          <button onClick={() => moveTask(setArr, arr, idx, "down")} className="text-lg text-black" aria-label="move down">↓</button>
          {extras}
        </div>
      </div>
    );
  };

  // ---------- render ----------
  return (
    <div className={`${inter.className} grid grid-cols-1 md:grid-cols-3 gap-6 p-6 items-start`}>
      {/* Carry Over */}
      <section className="bg-white rounded-lg p-6 border border-gray-300 shadow-md">
        <h3 className="text-lg font-bold mb-4 text-center text-black">Carry Over</h3>
        {carryOverTasks.length === 0 ? (
          <p className="text-sm text-gray-500 text-center">No carry-over tasks</p>
        ) : (
          carryOverTasks.map((t, i) =>
            renderTask(t, i, carryOverTasks, setCarryOverTasks, (
              <>
                <button onClick={() => addToToday(t._id)} className="bg-green-600 text-white px-2 py-1 rounded-md text-sm">Add</button>
                <button onClick={() => deleteTask(t._id, t.clientTempId)} className="text-lg text-red-600" aria-label="delete">×</button>
              </>
            ))
          )
        )}
      </section>

      {/* Today */}
      <main className="bg-white rounded-lg p-6 border border-gray-300 shadow-md">
        <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-black">
            {dateInfo.date || new Date().toLocaleDateString()}
            </h2>
            <button
            onClick={() => setShowForm((s) => !s)}
            className="text-3xl text-blue-600"
            aria-label="toggle add form"
            >
            +
            </button>
        </div>

        {showForm && (
            <div className="mb-3 space-y-2">
            <input
                type="text"
                placeholder="Task (Title & More Info)"
                value={newTask}
                onChange={(e) => setNewTask(e.target.value)}
                onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    addTask();
                }
                }}
                className="w-11/12 p-2 border rounded bg-white text-black"
            />
            <input
                type="time"
                value={dueTime}
                onChange={(e) => setDueTime(e.target.value)}
                className="w-11/12 p-2 border rounded bg-white text-black"
            />
            <button
                onClick={addTask}
                className="w-11/12 bg-blue-600 text-white p-2 rounded-md"
            >
                Add Task
            </button>
            </div>
        )}

        {todayTasks.length === 0 ? (
            <p className="text-sm text-gray-500">No tasks for today</p>
        ) : (
            todayTasks.map((t, i) =>
            renderTask(t, i, todayTasks, setTodayTasks, (
                <>
                <input
                    type="checkbox"
                    onChange={() => markComplete(t._id, t.clientTempId)}
                    aria-label="complete"
                />
                <button
                    onClick={() => deleteTask(t._id, t.clientTempId)}
                    className="text-lg text-red-600"
                    aria-label="delete"
                >
                    ×
                </button>
                </>
            ))
            )
        )}
        </main>

      {/* Completed */}
      <section className="bg-white rounded-lg p-6 border border-gray-300 shadow-md">
        <h3 className="text-lg font-bold mb-4 text-center text-black">Completed</h3>
        {completedTasks.length === 0 ? (
          <p className="text-sm text-gray-500 text-center">No completed tasks</p>
        ) : (
          completedTasks.map((t, i) =>
            renderTask(t, i, completedTasks, setCompletedTasks, (
              <button onClick={() => deleteTask(t._id, t.clientTempId)} className="text-lg text-red-600">×</button>
            ))
          )
        )}
      </section>
    </div>
  );
}
