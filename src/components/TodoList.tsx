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

  const fetchTasks = async () => {
    try {
      const res = await fetch("/api/tasks");
      const data = await res.json();
      const today = data.today ?? [];
      const carryOver = data.carryOver ?? [];
      const completed = data.completed ?? [];

      setTodayTasks(Array.isArray(today) ? today : []);
      setCarryOverTasks(Array.isArray(carryOver) ? carryOver : []);
      setCompletedTasks(Array.isArray(completed) ? completed : []);
    } catch (err) {
      console.error("Failed to fetch tasks:", err);
    }
  };

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
    } catch {}
    setDateInfo({ date: formatLocalDate(new Date()) });
  };

  const formatLocalDate = (d: Date) =>
    d.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

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
    await fetch(`/api/tasks/${id}`, { method: "DELETE" });
    setTodayTasks(prev => prev.filter(t => t._id !== id));
    setCarryOverTasks(prev => prev.filter(t => t._id !== id));
    setCompletedTasks(prev => prev.filter(t => t._id !== id));
  };

  const markComplete = async (id: string) => {
    await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed: true }),
    });
    setTodayTasks(prev => prev.filter(t => t._id !== id));
    setCompletedTasks(prev => prev.filter(t => t._id !== id));
    fetchTasks();
  };

  const addToToday = async (id: string) => {
    const todayStr = new Date().toISOString().split("T")[0];
    await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ carryOver: false, date: todayStr }),
    });
    fetchTasks();
  };

  const moveTask = (setArr: (v: Task[]) => void, arr: Task[], index: number, dir: "up" | "down") => {
    const updated = [...arr];
    const swapIndex = dir === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= arr.length) return;
    [updated[index], updated[swapIndex]] = [updated[swapIndex], updated[index]];
    setArr(updated);
  };

  const clearOldCompleted = async () => {
    const todayStr = new Date().toISOString().split("T")[0];
    await fetch(`/api/tasks/clearCompleted?date=${todayStr}`, { method: "DELETE" });
  };

  useEffect(() => {
    clearOldCompleted();
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
        className="flex justify-between items-center p-3 mb-3 rounded-md border border-gray-300 shadow-sm w-[250px]"
        style={{ backgroundColor: bg, color: "black" }}
      >
        <div>
          <div className="font-semibold text-base">{task.text}</div>
          {task.due && <div className="text-xs mt-1">Due: {formatTime(task.due)}</div>}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => moveTask(setArr, arr, index, "up")} className="text-lg">↑</button>
          <button onClick={() => moveTask(setArr, arr, index, "down")} className="text-lg">↓</button>
          {extras}
        </div>
      </div>
    );
  };

  return (
    <div className={`${inter.className} flex gap-6 p-6 bg-gray-50`}>
      {/* Carry Over */}
      <section>
        <h3 className="text-lg font-bold mb-4 text-center">Carry Over</h3>
        {(carryOverTasks ?? []).map((t, i) =>
          renderTask(t, i, carryOverTasks, setCarryOverTasks, <>
            <button onClick={() => addToToday(t._id!)} className="bg-green-600 text-white px-2 py-1 rounded-md">Add</button>
            <button onClick={() => deleteTask(t._id!)} className="text-lg text-red-600">×</button>
          </>)
        )}
      </section>

      {/* Today */}
      <main>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">{dateInfo.date}</h2>
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
            <input
              type="time"
              value={dueTime}
              onChange={e => setDueTime(e.target.value)}
              className="w-full p-2 border rounded bg-white text-black"
            />
            <button onClick={addTask} className="w-full bg-blue-600 text-white p-2 rounded-md">Add Task</button>
          </div>
        )}
        {(todayTasks ?? []).map((t, i) =>
          renderTask(t, i, todayTasks, setTodayTasks, <>
            <input type="checkbox" onChange={() => markComplete(t._id!)} />
            <button onClick={() => deleteTask(t._id!)} className="text-lg text-red-600">×</button>
          </>)
        )}
      </main>

      {/* Completed */}
      <section>
        <h3 className="text-lg font-bold mb-4 text-center">Completed</h3>
        {(completedTasks ?? []).map((t, i) =>
          renderTask(t, i, completedTasks, setCompletedTasks,
            <button onClick={() => deleteTask(t._id!)} className="text-lg text-red-600">×</button>
          )
        )}
      </section>
    </div>
  );
}
