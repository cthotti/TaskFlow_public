// src/components/TodoList.tsx
"use client";
import React, { useEffect, useState } from "react";
import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"], weight: ["400", "600", "700"] });

type Task = {
  _id?: string;
  text: string;
  due?: string;
  color?: string;
  completed?: boolean;
  carryOver?: boolean;
  date?: string;
};

type DateInfo = { date: string };

export default function TodoList() {
  const [todayTasks, setTodayTasks] = useState<Task[]>([]);
  const [carryOverTasks, setCarryOverTasks] = useState<Task[]>([]);
  const [completedTasks, setCompletedTasks] = useState<Task[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [newTask, setNewTask] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [dateInfo, setDateInfo] = useState<DateInfo>({ date: "" });

  const pastelColors = [
    "#FFDEE9", "#B5FFFC", "#C9FFBF", "#FFD6A5", "#FEC5E5",
    "#D5AAFF", "#FFFACD", "#C1F0F6", "#FFB3BA", "#BAFFC9"
  ];

  // Safe fetchTasks: support multiple possible API response keys
  const fetchTasks = async () => {
    try {
      const res = await fetch("/api/tasks");
      const data = await res.json();

      // Accept multiple possible shapes (robustness)
      const today = data.today ?? data.todayTasks ?? data.todayTasks ?? data.todayTasksList ?? [];
      const carryOver = data.carryOver ?? data.carryOverTasks ?? data.carryover ?? [];
      const completed = data.completed ?? data.completedTasks ?? data.done ?? [];

      setTodayTasks(Array.isArray(today) ? today : []);
      setCarryOverTasks(Array.isArray(carryOver) ? carryOver : []);
      setCompletedTasks(Array.isArray(completed) ? completed : []);
    } catch (err) {
      console.error("Failed to fetch tasks:", err);
      setTodayTasks([]);
      setCarryOverTasks([]);
      setCompletedTasks([]);
    }
  };

  // Try python backend /date, fallback to client date
  const fetchDate = async () => {
    try {
      if (process.env.NEXT_PUBLIC_API_URL) {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/date`);
        if (res.ok) {
          const d = await res.json();
          setDateInfo({ date: d.date ?? formatLocalDate(new Date()) });
          return;
        }
      }
    } catch (err) {
      console.warn("Date endpoint not reachable, falling back to local date.");
    }
    setDateInfo({ date: formatLocalDate(new Date()) });
  };

  const formatLocalDate = (d: Date) =>
    d.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  // Sort helper (sort HH:MM strings)
  const sortByTime = (arr: Task[]) =>
    [...arr].sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""));

  const addTask = async () => {
    if (!newTask || !dueTime) return;
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: newTask, due: dueTime }),
      });
      const data = await res.json();
      const newT: Task = data.task ?? data;
      setTodayTasks(prev => sortByTime([...prev, newT]));
      setNewTask("");
      setDueTime("");
      setShowForm(false);
    } catch (err) {
      console.error("Failed to add task:", err);
    }
  };

  const deleteTask = async (id: string) => {
    try {
      await fetch(`/api/tasks/${id}`, { method: "DELETE" });
      setTodayTasks(prev => prev.filter(t => t._id !== id));
      setCarryOverTasks(prev => prev.filter(t => t._id !== id));
      setCompletedTasks(prev => prev.filter(t => t._id !== id));
    } catch (err) {
      console.error("Delete failed:", err);
    }
  };

  // markComplete: PATCH and update UI optimistically
  const markComplete = async (id: string) => {
    try {
      const res = await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: true }),
      });
      const data = await res.json();
      const updated: Task | undefined = data.task ?? data;
      // remove from today and add to completed
      setTodayTasks(prev => prev.filter(t => t._id !== id));
      if (updated) setCompletedTasks(prev => [updated, ...prev]);
      else {
        // fallback: refetch
        fetchTasks();
      }
    } catch (err) {
      console.error("Mark complete failed:", err);
      fetchTasks();
    }
  };

  // Move carry-over to today
  const addToToday = async (id: string) => {
    try {
      const todayStr = new Date().toISOString().split("T")[0];
      const res = await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ carryOver: false, date: todayStr }),
      });
      const data = await res.json();
      const updated: Task | undefined = data.task ?? data;
      setCarryOverTasks(prev => prev.filter(t => t._id !== id));
      if (updated) setTodayTasks(prev => sortByTime([...prev, updated]));
      else fetchTasks();
    } catch (err) {
      console.error("Add to today failed:", err);
      fetchTasks();
    }
  };

  // Move up/down locally (UI only)
  const moveTask = (listSetter: (v: Task[]) => void, arr: Task[], index: number, dir: "up" | "down") => {
    const updated = [...arr];
    const swapIndex = dir === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= arr.length) return;
    [updated[index], updated[swapIndex]] = [updated[swapIndex], updated[index]];
    listSetter(updated);
  };

  useEffect(() => {
    fetchTasks();
    fetchDate();
  }, []);

  const formatTime = (time?: string) => {
    if (!time) return "";
    const [hh, mm] = time.split(":").map(Number);
    const ampm = hh >= 12 ? "PM" : "AM";
    const hour12 = hh % 12 || 12;
    return `${hour12}:${mm.toString().padStart(2, "0")} ${ampm}`;
  };

  // Render single task
  const renderTask = (
    task: Task,
    index: number,
    arr: Task[],
    setArr: (v: Task[]) => void,
    extras?: React.ReactNode
  ) => {
    const bg = task.color ?? pastelColors[(task.text?.length ?? 0) % pastelColors.length];
    return (
      <div
        key={task._id}
        className={`${inter.className} flex justify-between items-center p-5 mb-4 rounded-lg border border-gray-300 shadow-sm`}
        style={{ backgroundColor: bg, color: "black" }}
      >
        <div>
          <div className="font-semibold text-lg">{task.text}</div>
          {task.due && <div className="text-sm mt-1">Due: {formatTime(task.due)}</div>}
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => moveTask(setArr, arr, index, "up")}
            className="text-2xl font-bold text-black"
            aria-label="move up"
          >
            ↑
          </button>
          <button
            onClick={() => moveTask(setArr, arr, index, "down")}
            className="text-2xl font-bold text-black"
            aria-label="move down"
          >
            ↓
          </button>

          {extras}
        </div>
      </div>
    );
  };

  return (
    <div className={`${inter.className} grid grid-cols-1 md:grid-cols-[1fr_1.6fr_1fr] gap-6 p-6 bg-gray-50 min-h-[60vh]`}>
      {/* Left: Carry Over */}
      <section className="bg-white rounded-lg p-6 border border-gray-200 shadow-md h-auto">
        <h3 className="text-lg font-bold mb-4 text-center">Carry Over</h3>
        {(carryOverTasks ?? []).length === 0 && <p className="text-sm text-gray-500">No carry-over tasks</p>}
        {(carryOverTasks ?? []).map((t, i) =>
          renderTask(
            t,
            i,
            carryOverTasks,
            setCarryOverTasks,
            <>
              <button
                onClick={() => addToToday(t._id!)}
                className="bg-green-600 text-white px-3 py-1 rounded-md"
              >
                Add
              </button>
              <button onClick={() => deleteTask(t._id!)} className="text-2xl text-red-600">×</button>
            </>
          )
        )}
      </section>

      {/* Middle: Today (wider) */}
      <main className="bg-white rounded-lg p-6 border border-gray-200 shadow-md h-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">{dateInfo.date || formatLocalDate(new Date())}</h2>
          <button onClick={() => setShowForm(s => !s)} className="text-4xl text-blue-600">+</button>
        </div>

        {showForm && (
          <div className="mb-4 space-y-3">
            <input
              type="text"
              placeholder="Task"
              value={newTask}
              onChange={e => setNewTask(e.target.value)}
              className="w-full p-3 border rounded bg-white text-black"
            />
            <input
              type="time"
              value={dueTime}
              onChange={e => setDueTime(e.target.value)}
              className="w-full p-3 border rounded bg-white text-black"
            />
            <button onClick={addTask} className="w-full bg-blue-600 text-white p-3 rounded-md">Add Task</button>
          </div>
        )}

        {(todayTasks ?? []).length === 0 && <p className="text-sm text-gray-500">No tasks for today</p>}
        {(todayTasks ?? []).map((t, i) =>
          renderTask(
            t,
            i,
            todayTasks,
            setTodayTasks,
            <>
              <input
                type="checkbox"
                className="w-6 h-6"
                onChange={() => markComplete(t._id!)}
                aria-label="mark complete"
              />
              <button onClick={() => deleteTask(t._id!)} className="text-2xl text-red-600">×</button>
            </>
          )
        )}
      </main>

      {/* Right: Completed */}
      <section className="bg-white rounded-lg p-6 border border-gray-200 shadow-md h-auto">
        <h3 className="text-lg font-bold mb-4 text-center">Completed</h3>
        {(completedTasks ?? []).length === 0 && <p className="text-sm text-gray-500">No completed tasks</p>}
        {(completedTasks ?? []).map((t, i) =>
          renderTask(
            t,
            i,
            completedTasks,
            setCompletedTasks,
            <button onClick={() => deleteTask(t._id!)} className="text-2xl text-red-600">×</button>
          )
        )}
      </section>
    </div>
  );
}
