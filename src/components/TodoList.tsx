"use client";
import { useEffect, useState } from "react";
import { Inter } from "next/font/google";
import React from "react";

const inter = Inter({ subsets: ["latin"], weight: ["400", "600", "700"] });

type Task = {
  _id?: string;
  text: string;
  due: string;
  color: string;
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
    setCarryOverTasks(data.carryOver);
    setCompletedTasks(data.completed);
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
      body: JSON.stringify({ text: newTask, due: dueTime }),
    });
    const data = await res.json();
    setTodayTasks([...todayTasks, data.task]);
    setNewTask("");
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
      className={`${inter.className} flex justify-between items-center p-4 mb-3 rounded-lg border border-gray-300 shadow-md`}
      style={{
        backgroundColor: task.color || pastelColors[Math.floor(Math.random() * pastelColors.length)],
      }}
    >
      <div className="flex flex-col">
        <span className="font-semibold text-lg">{task.text}</span>
        {task.due && <span className="text-md">{formatTime(task.due)}</span>}
      </div>
      <div className="flex items-center space-x-3">
        <button onClick={() => moveTask(tasks, setTasks, index, "up")} className="text-3xl">↑</button>
        <button onClick={() => moveTask(tasks, setTasks, index, "down")} className="text-3xl">↓</button>
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
    <div className={`${inter.className} grid grid-cols-3 gap-6 p-6`}>
      {/* Carry Over */}
      <div className="bg-gray-50 rounded-lg p-6 border border-gray-300 shadow-lg">
        <h2 className="text-xl font-bold mb-4">Carry Over</h2>
        {carryOverTasks.map((t, i) =>
          renderTask(t, i, carryOverTasks, setCarryOverTasks, (
            <>
              <button onClick={() => addToToday(t._id!)} className="bg-blue-500 text-white px-3 py-1 rounded-lg">Add</button>
              <button onClick={() => deleteTask(t._id!)} className="text-3xl text-red-500">×</button>
            </>
          ))
        )}
      </div>

      {/* Today */}
      <div className="bg-gray-50 rounded-lg p-6 border border-gray-300 shadow-lg">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">{dateInfo.date}</h2>
          <button onClick={() => setShowForm(!showForm)} className="text-4xl text-blue-600">+</button>
        </div>
        {showForm && (
          <div className="mb-4 space-y-2">
            <input
              type="text"
              placeholder="Task"
              value={newTask}
              onChange={(e) => setNewTask(e.target.value)}
              className="w-full p-2 border rounded"
            />
            <input
              type="time"
              value={dueTime}
              onChange={(e) => setDueTime(e.target.value)}
              className="w-full p-2 border rounded"
            />
            <button
              onClick={addTask}
              className="w-full bg-blue-500 hover:bg-blue-600 text-white p-2 rounded"
            >
              Add Task
            </button>
          </div>
        )}
        {todayTasks.map((t, i) =>
          renderTask(t, i, todayTasks, setTodayTasks, (
            <>
              <input type="checkbox" onChange={() => markComplete(t._id!)} className="w-6 h-6" />
              <button onClick={() => deleteTask(t._id!)} className="text-3xl text-red-500">×</button>
            </>
          ))
        )}
      </div>

      {/* Completed */}
      <div className="bg-gray-50 rounded-lg p-6 border border-gray-300 shadow-lg">
        <h2 className="text-xl font-bold mb-4">Completed</h2>
        {completedTasks.map((t, i) =>
          renderTask(t, i, completedTasks, setCompletedTasks, (
            <button onClick={() => deleteTask(t._id!)} className="text-3xl text-red-500">×</button>
          ))
        )}
      </div>
    </div>
  );
}