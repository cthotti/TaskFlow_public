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
    await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ carryOver: false, date: new Date().toISOString().split("T")[0] }),
    });
    fetchTasks();
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
      className={`${inter.className} flex justify-between items-start p-3 mb-3 rounded-md border border-gray-200 shadow-sm`}
      style={{
        backgroundColor: task.color || pastelColors[Math.floor(Math.random() * pastelColors.length)],
        color: "black",
      }}
    >
      <div className="flex-1 space-y-1">
        <span className="font-semibold text-base">{task.text}</span>
        {task.description && (
          <p className="text-sm text-gray-700 whitespace-pre-line">{task.description}</p>
        )}
        {task.due && <span className="text-xs text-gray-600">Due: {formatTime(task.due)}</span>}
      </div>
      <div className="flex items-center gap-2 ml-2">
        <button onClick={() => moveTask(tasks, setTasks, index, "up")} className="text-sm">↑</button>
        <button onClick={() => moveTask(tasks, setTasks, index, "down")} className="text-sm">↓</button>
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
      <section className="bg-white rounded-lg p-6 border border-gray-300 shadow-md">
        <h2 className="text-lg font-bold mb-4 text-center text-black">Carry Over</h2>
        {(carryOverTasks ?? []).length === 0 ? (
          <p className="text-sm text-gray-500 text-center">No carry-over tasks</p>
        ) : (
          (carryOverTasks ?? []).map((t, i) =>
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
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-black">{dateInfo.date}</h2>
          <button onClick={() => setShowForm(!showForm)} className="text-3xl text-blue-600">+</button>
        </div>
        {showForm && (
          <div className="mb-4 space-y-2">
            <input
              type="text"
              placeholder="Task"
              value={newTask}
              onChange={(e) => setNewTask(e.target.value)}
              className="w-full p-2 border rounded bg-white text-black"
            />
            <textarea
              placeholder="Description"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              className="w-full p-2 border rounded bg-white text-black"
              rows={3}
            />
            <input
              type="time"
              value={dueTime}
              onChange={(e) => setDueTime(e.target.value)}
              className="w-full p-2 border rounded bg-white text-black"
            />
            <button
              onClick={addTask}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white p-2 rounded-md"
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
                <input type="checkbox" onChange={() => markComplete(t._id!)} className="w-5 h-5" />
                <button onClick={() => deleteTask(t._id!)} className="text-lg text-red-600">×</button>
              </>
            ))
          )
        )}
      </main>

      {/* Completed */}
      <section className="bg-white rounded-lg p-6 border border-gray-300 shadow-md">
        <h2 className="text-lg font-bold mb-4 text-center text-black">Completed</h2>
        {completedTasks.length === 0 ? (
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
