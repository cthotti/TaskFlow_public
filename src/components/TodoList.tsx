// src/components/TodoList.tsx
"use client";
import { useEffect, useState } from "react";
import { Inter } from "next/font/google";
import React from "react";

const inter = Inter({ subsets: ["latin"], weight: ["400", "600", "700"] });

type Task = {
  _id?: string;
  text: string;
  due?: string;
  description?: string;
  color?: string;
  completed?: boolean;
  carryOver?: boolean;
};

type DateInfo = { date: string };

export default function TodoList() {
  const [todayTasks, setTodayTasks] = useState<Task[]>([]);
  const [carryOverTasks, setCarryOverTasks] = useState<Task[]>([]);
  const [completedTasks, setCompletedTasks] = useState<Task[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [newTask, setNewTask] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [dateInfo, setDateInfo] = useState<DateInfo>({ date: "" });

  const pastelColors = [
    "#FFDEE9", "#B5FFFC", "#C9FFBF", "#FFD6A5", "#FEC5E5",
    "#D5AAFF", "#FFFACD", "#C1F0F6", "#FFB3BA", "#BAFFC9"
  ];

  const fetchTasks = async () => {
    const res = await fetch("/api/tasks");
    const data = await res.json();
    setTodayTasks(data.today);
    setCarryOverTasks(data.carryOver ?? []);
    setCompletedTasks(data.completed ?? []);
  };

  const fetchDate = async () => {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/date`);
    const data = await res.json();
    setDateInfo(data);
  };

  const addTask = async () => {
    if (!newTask || !dueTime) return;
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: newTask, description: newDescription, due: dueTime }),
    });
    const data = await res.json();
    setTodayTasks([...todayTasks, data.task]);
    setNewTask("");
    setNewDescription("");
    setDueTime("");
    setShowForm(false);
  };

  const deleteTask = async (id: string) => {
    await fetch(`/api/tasks/${id}`, { method: "DELETE" });
    setTodayTasks(todayTasks.filter((t) => t._id !== id));
    setCarryOverTasks(carryOverTasks.filter((t) => t._id !== id));
    setCompletedTasks(completedTasks.filter((t) => t._id !== id));
  };

  const markComplete = async (id: string) => {
    await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed: true }),
    });
    fetchTasks();
  };

  const addToToday = async (id: string) => {
    try {
      const res = await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ carryOver: false}),
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


  const moveTask = (tasks: Task[], setTasks: any, index: number, direction: "up" | "down") => {
    const updated = [...tasks];
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= tasks.length) return;
    [updated[index], updated[swapIndex]] = [updated[swapIndex], updated[index]];
    setTasks(updated);
  };

  useEffect(() => {
    fetchTasks();
    fetchDate();
  }, []);

  const renderTask = (
    task: Task,
    index: number,
    tasks: Task[],
    setTasks: any,
    extraButtons?: React.ReactNode
  ) => (
    <div
    key={task._id}
    className="flex flex-col bg-neutral-900 text-white rounded-md px-4 py-3 mb-2 shadow-sm"
  >
    {/* Top row: Title + Due Time */}
    <div className="flex justify-between items-center">
      <span className="font-medium text-base">{task.text}</span>
      {task.due && (
        <span className="text-xs text-gray-400">{formatTime(task.due)}</span>
      )}
    </div>

    {/* Description */}
    {task.description && (
      <p className="text-xs text-gray-500 mt-1 whitespace-pre-line">
        {task.description}
      </p>
    )}

    {/* Bottom row: controls */}
    <div className="flex items-center gap-2 mt-2 text-gray-400 text-sm">
      <button onClick={() => moveTask(tasks, setTasks, index, "up")}>↑</button>
      <button onClick={() => moveTask(tasks, setTasks, index, "down")}>↓</button>
      {extraButtons}
    </div>
  </div>
  );

  const formatTime = (time: string) => {
    const [hour, minute] = time.split(":").map(Number);
    const ampm = hour >= 12 ? "PM" : "AM";
    const hour12 = hour % 12 || 12;
    return `${hour12}:${minute.toString().padStart(2, "0")} ${ampm}`;
  };

  return (
  <div className={`${inter.className} grid grid-cols-1 md:grid-cols-3 gap-6 p-6 items-start`}>
    {/* Carry Over */}
    <section className="flex flex-col items-center w-80">
      <h2 className="w-full text-center text-lg font-bold text-white border border-gray-600 rounded-md py-2 mb-3">
        Carry Over
      </h2>
      {(carryOverTasks ?? []).length === 0 ? (
        <p className="text-sm text-gray-500 text-center">No carry-over tasks</p>
      ) : (
        (carryOverTasks ?? []).map((t, i) =>
          renderTask(t, i, carryOverTasks, setCarryOverTasks, (
            <>
              <button
                onClick={() => addToToday(t._id!)}
                className="text-gray-400 hover:text-white text-sm"
              >
                Add
              </button>
              <button
                onClick={() => deleteTask(t._id!)}
                className="text-gray-400 hover:text-white text-sm"
              >
                ×
              </button>
            </>
          ))
        )
      )}
    </section>

    {/* Today */}
    <main className="flex flex-col items-center w-80">
      <div className="w-full flex justify-between items-center border border-gray-600 rounded-md px-3 py-2 mb-3">
        <h2 className="text-lg font-bold text-white">{dateInfo.date}</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="text-2xl text-gray-400 hover:text-white"
        >
          +
        </button>
      </div>

      {showForm && (
        <div className="mb-4 space-y-2 w-full">
          <input
            type="text"
            placeholder="Task"
            value={newTask}
            onChange={(e) => setNewTask(e.target.value)}
            className="w-full p-2 border border-gray-700 rounded bg-black text-white"
          />
          <textarea
            placeholder="Description"
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            className="w-full p-2 border border-gray-700 rounded bg-black text-white"
            rows={3}
          />
          <input
            type="time"
            value={dueTime}
            onChange={(e) => setDueTime(e.target.value)}
            className="w-full p-2 border border-gray-700 rounded bg-black text-white"
          />
          <button
            onClick={addTask}
            className="w-full bg-gray-700 hover:bg-gray-600 text-white p-2 rounded-md"
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
                onChange={() => markComplete(t._id!)}
                className="w-4 h-4 accent-gray-500"
              />
              <button
                onClick={() => deleteTask(t._id!)}
                className="text-gray-400 hover:text-white text-sm"
              >
                ×
              </button>
            </>
          ))
        )
      )}
    </main>

    {/* Completed */}
    <section className="flex flex-col items-center w-80">
      <h2 className="w-full text-center text-lg font-bold text-white border border-gray-600 rounded-md py-2 mb-3">
        Completed
      </h2>
      {completedTasks.length === 0 ? (
        <p className="text-sm text-gray-500 text-center">No completed tasks</p>
      ) : (
        completedTasks.map((t, i) =>
          renderTask(t, i, completedTasks, setCompletedTasks, (
            <button
              onClick={() => deleteTask(t._id!)}
              className="text-gray-400 hover:text-white text-sm"
            >
              ×
            </button>
          ))
        )
      )}
    </section>
  </div>
);
}
