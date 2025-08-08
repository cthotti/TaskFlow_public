"use client";
import { useEffect, useState } from "react";
import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"] });

type Task = {
  _id?: string;
  text: string;
  due: string;
  color: string;
};

type DateInfo = {
  date: string;
};

export default function TodoList() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [newTask, setNewTask] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [dateInfo, setDateInfo] = useState<DateInfo>({ date: "" });

  const formatTime12Hour = (time: string) => {
    if (!time) return "";
    const [hour, minute] = time.split(":").map(Number);
    const ampm = hour >= 12 ? "PM" : "AM";
    const adjustedHour = hour % 12 || 12;
    return `${adjustedHour}:${minute.toString().padStart(2, "0")} ${ampm}`;
  };

  const sortTasksByTime = (tasksArray: Task[]) => {
    return [...tasksArray].sort((a, b) => {
      const timeA = a.due.padStart(5, "0");
      const timeB = b.due.padStart(5, "0");
      return timeA.localeCompare(timeB);
    });
  };

  const fetchTasks = async () => {
    const res = await fetch("/api/tasks");
    const data = await res.json();
    setTasks(sortTasksByTime(data.tasks));
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
    setTasks(sortTasksByTime([...tasks, data.task]));
    setNewTask("");
    setDueTime("");
    setShowForm(false);
  };

  const deleteTask = async (id: string) => {
    await fetch(`/api/tasks/${id}`, { method: "DELETE" });
    setTasks(tasks.filter((task) => task._id !== id));
  };

  const moveTaskUp = (index: number) => {
    if (index === 0) return;
    const updatedTasks = [...tasks];
    [updatedTasks[index - 1], updatedTasks[index]] = [updatedTasks[index], updatedTasks[index - 1]];
    setTasks(updatedTasks);
  };

  const moveTaskDown = (index: number) => {
    if (index === tasks.length - 1) return;
    const updatedTasks = [...tasks];
    [updatedTasks[index + 1], updatedTasks[index]] = [updatedTasks[index], updatedTasks[index + 1]];
    setTasks(updatedTasks);
  };

  useEffect(() => {
    fetchTasks();
    fetchDate();
  }, []);

  return (
    <div className={`bg-gray-100 rounded-lg p-6 max-w-md mx-auto text-black ${inter.className}`}>
      <div className="flex justify-between items-center p-4 mb-3 rounded-lg shadow-md">
        <h2 className="text-xl font-semibold">{dateInfo.date}</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="text-4xl text-blue-500 hover:text-blue-700"
        >
          +
        </button>
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

      {tasks.map((task, index) => (
        <div key={task._id} className="flex items-center space-x-4">
          {/* Task Box */}
          <div
            className="flex justify-between items-center p-4 mb-2 rounded flex-grow"
            style={{ backgroundColor: task.color }}
          >
            <div>
              <div className="font-semibold text-lg text-black">{task.text}</div>
              <div className="text-md text-black">Due: {formatTime12Hour(task.due)}</div>
            </div>

            <div className="flex items-center space-x-3">
              <button
                onClick={() => moveTaskUp(index)}
                className="text-2xl text-gray-700 hover:text-black"
              >
                ↑
              </button>
              <button
                onClick={() => moveTaskDown(index)}
                className="text-2xl text-gray-700 hover:text-black"
              >
                ↓
              </button>
            </div>
          </div>

          {/* Checkbox for Delete */}
          <input
            type="checkbox"
            className="w-6 h-6 cursor-pointer"
            onChange={() => deleteTask(task._id!)}
          />
        </div>
      ))}
    </div>
  );
}
