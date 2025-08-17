// src/components/TodoList.tsx
"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"], weight: ["400", "600", "700"] });

type Task = {
  _id?: string;
  text: string;
  due?: string;          // "HH:mm"
  description?: string;
  color?: string;
  completed?: boolean;   // <-- the only status flag we use
  date?: string;         // optional, still sent on create: "YYYY-MM-DD"
};

type DateInfo = { date: string };

// small debounce helper for saving edits
function debounce<T extends (...args: any[]) => void>(fn: T, ms = 400) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export default function TodoList() {
  const fetchVersion = useRef(0);

  const [activeTasks, setActiveTasks] = useState<Task[]>([]);
  const [completedTasks, setCompletedTasks] = useState<Task[]>([]);

  const [showForm, setShowForm] = useState(false);
  const [newTask, setNewTask] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [dateInfo, setDateInfo] = useState<DateInfo>({ date: "" });

  const pastelColors = useMemo(
    () => ["#FFDEE9","#B5FFFC","#C9FFBF","#FFD6A5","#FEC5E5","#D5AAFF","#FFFACD","#C1F0F6","#FFB3BA","#BAFFC9"],
    []
  );

  const localISODate = (): string => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  };

  const formatLocalDate = (d: Date) =>
    d.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

  const formatTime = (time?: string) => {
    if (!time) return "";
    const [hhStr, mmStr] = time.split(":");
    const hh = Number(hhStr);
    const mm = Number(mmStr ?? 0);
    const hh12 = hh % 12 || 12;
    const ampm = hh >= 12 ? "PM" : "AM";
    return `${hh12}:${String(mm).padStart(2, "0")} ${ampm}`;
  };

  // ---------- FETCH TASKS (no carryOver; partition by completed) ----------
  const fetchTasks = async () => {
    const ticket = ++fetchVersion.current;
    try {
      const res = await fetch("/api/tasks", { cache: "no-store" });
      if (!res.ok) throw new Error(`GET /api/tasks ${res.status}`);
      const data = await res.json();

      // Accept several response shapes
      // 1) buckets: { active, completed } or { today, completed } etc.
      const bucketActive =
        (data as any).active ??
        (data as any).today ??
        (data as any).todayTasks;
      const bucketCompleted =
        (data as any).completed ??
        (data as any).completedTasks;

      if (Array.isArray(bucketActive) || Array.isArray(bucketCompleted)) {
        if (ticket !== fetchVersion.current) return;
        setActiveTasks(sortByDue(bucketActive ?? []));
        setCompletedTasks(bucketCompleted ?? []);
        return;
      }

      // 2) tasks array or flat array
      let all: any[] = [];
      if (Array.isArray(data)) all = data;
      else if (Array.isArray((data as any).tasks)) all = (data as any).tasks;
      else {
        const maybe = Object.values(data).find(Array.isArray) as any[] | undefined;
        all = maybe ?? [];
      }

      const active: Task[] = [];
      const completed: Task[] = [];
      all.forEach((t: any) => {
        const task: Task = {
          _id: t._id ?? t.id,
          text: t.text ?? "",
          due: t.due ?? t.time,
          description: t.description ?? t.desc ?? "",
          color: t.color,
          completed: !!t.completed, // only flag we respect
          date: t.date,
        };
        (task.completed ? completed : active).push(task);
      });

      if (ticket !== fetchVersion.current) return;
      setActiveTasks(sortByDue(active));
      setCompletedTasks(completed);
    } catch (e) {
      console.error("fetchTasks failed:", e);
      // keep existing lists on error
    }
  };

  const sortByDue = (arr: Task[]) =>
    [...arr].sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""));

  // ---------- FETCH DATE ----------
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
      // ignore and fallback
    }
    setDateInfo({ date: formatLocalDate(new Date()) });
  };

  // ---------- ADD TASK (no carryOver; completed=false) ----------
  const addTask = async () => {
    if (!newTask.trim() || !dueTime) return;
    try {
      const payload = {
        text: newTask.trim(),
        due: dueTime,
        description: newDescription,
        completed: false,
        date: localISODate(), // optional; harmless to keep
      };

      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("POST /api/tasks " + res.status);

      // accept {task}, object, or array w/first element
      const created = await res.json().catch(() => null);
      const serverTask: any =
        created?.task ??
        (Array.isArray(created) ? created[0] : created) ??
        {};
      const saved: Task = {
        ...payload,
        ...serverTask,
        _id: serverTask._id ?? serverTask.id ?? `temp-${Date.now()}`,
      };

      // optimistic + sort
      setActiveTasks(prev => sortByDue([...prev, saved]));

      // gentle resync
      setTimeout(fetchTasks, 250);

      // reset form
      setNewTask("");
      setNewDescription("");
      setDueTime("");
      setShowForm(false);
    } catch (err) {
      console.error("Failed to add task:", err);
    }
  };

  // ---------- DELETE ----------
  const deleteTask = async (id?: string) => {
    if (!id) return;
    try {
      await fetch(`/api/tasks/${id}`, { method: "DELETE" });
      setActiveTasks(prev => prev.filter(t => t._id !== id));
      setCompletedTasks(prev => prev.filter(t => t._id !== id));
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  // ---------- TOGGLE COMPLETE ----------
  const toggleComplete = async (id?: string, nextCompleted?: boolean) => {
    if (!id) return;
    // optimistic move
    if (nextCompleted) {
      const found = activeTasks.find(t => t._id === id);
      if (found) {
        setActiveTasks(prev => prev.filter(t => t._id !== id));
        setCompletedTasks(prev => [{ ...found, completed: true }, ...prev]);
      }
    } else {
      const found = completedTasks.find(t => t._id === id);
      if (found) {
        setCompletedTasks(prev => prev.filter(t => t._id !== id));
        setActiveTasks(prev => sortByDue([...prev, { ...found, completed: false }]));
      }
    }

    try {
      const res = await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: !!nextCompleted }),
      });
      if (!res.ok) {
        console.warn("toggleComplete patch failed", res.status);
        fetchTasks(); // restore truth
      } else {
        // if server returns the updated task, replace optimistic with it
        const data = await res.json().catch(() => null);
        const updated: Task | null = data?.task ?? null;
        if (updated) {
          if (updated.completed) {
            setCompletedTasks(prev => {
              const without = prev.filter(t => t._id !== updated._id);
              return [updated, ...without];
            });
          } else {
            setActiveTasks(prev => {
              const without = prev.filter(t => t._id !== updated._id);
              return sortByDue([...without, updated]);
            });
          }
        }
      }
    } catch (err) {
      console.error("toggleComplete failed:", err);
      fetchTasks();
    }
  };

  // ---------- MOVE (local only) ----------
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

  // ---------- TASK CARD (compact; no temp rows; debounced save on edit) ----------
  const renderTask = (
    task: Task,
    idx: number,
    arr: Task[],
    setArr: (v: Task[]) => void,
    extras?: React.ReactNode
  ) => {
    const bg = task.color ?? "#1E1E1E";

    const saveTask = debounce(async (t: Task) => {
      if (!t._id || String(t._id).startsWith("temp-")) return; // don't save incomplete ids
      try {
        await fetch(`/api/tasks/${t._id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: t.text,
            description: t.description,
            due: t.due,
            completed: !!t.completed,
            date: t.date,
            color: t.color,
          }),
        });
      } catch (e) {
        console.error("saveTask failed:", e);
      }
    }, 450);

    const updateField = (field: keyof Task, value: any) => {
      const updated = arr.map((item, i) => (i === idx ? { ...item, [field]: value } : item));
      setArr(updated);
      const updatedTask = updated[idx];
      if (updatedTask?._id && !String(updatedTask._id).startsWith("temp-")) {
        saveTask(updatedTask);
      }
    };

    const key = task._id ?? `${task.text}-${idx}-${task.due ?? ""}`;

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
                if (e.key === "Enter" && !e.shiftKey) e.preventDefault(); // don't insert newline
              }}
              className="font-medium text-sm text-gray-100 bg-transparent outline-none flex-1"
              placeholder="Task name"
            />
            {task.due && (
              <span className="ml-2 text-[12px] text-gray-400 whitespace-nowrap">
                {formatTime(task.due)}
              </span>
            )}
          </div>

          <textarea
            value={task.description ?? ""}
            onChange={(e) => updateField("description", e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) e.preventDefault();
            }}
            className="text-xs text-gray-300 whitespace-pre-line w-full bg-transparent outline-none"
            placeholder="More info..."
            rows={1}
          />
        </div>

        <div className="flex items-center gap-2 ml-2">
          <button
            onClick={() => moveTask(setArr, arr, idx, "up")}
            className="text-base text-gray-400 hover:text-gray-200"
            aria-label="up"
          >
            ↑
          </button>
          <button
            onClick={() => moveTask(setArr, arr, idx, "down")}
            className="text-base text-gray-400 hover:text-gray-200"
            aria-label="down"
          >
            ↓
          </button>
          {extras}
        </div>
      </div>
    );
  };

  // ---------- RENDER ----------
  return (
    <div className={`${inter.className} grid grid-cols-1 md:grid-cols-2 gap-6 p-6 items-start`}>
      {/* Today / Active */}
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
            <button onClick={addTask} className="w-full bg-gray-700 text-gray-100 p-2 rounded-md hover:bg-gray-600">
              Add Task
            </button>
          </div>
        )}

        {(activeTasks ?? []).length === 0 ? (
          <p className="text-sm text-gray-500">No active tasks</p>
        ) : (
          activeTasks.map((t, i) =>
            renderTask(t, i, activeTasks, setActiveTasks, (
              <>
                <input
                  type="checkbox"
                  aria-label="complete"
                  checked={false}
                  onChange={() => toggleComplete(t._id, true)}
                  className="w-4 h-4 ml-1 mr-1"
                />
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
              <>
                <input
                  type="checkbox"
                  aria-label="uncomplete"
                  checked={true}
                  onChange={() => toggleComplete(t._id, false)}
                  className="w-4 h-4 ml-1 mr-1"
                />
                <button onClick={() => deleteTask(t._id)} className="text-lg text-gray-400 hover:text-red-500">×</button>
              </>
            ))
          )
        )}
      </section>
    </div>
  );
}
