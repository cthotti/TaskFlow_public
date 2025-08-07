"use client";
import { useEffect, useState } from "react";

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

  const fetchTasks = async () => {
    const res = await fetch("/api/tasks");
    const data = await res.json();
    setTasks(data.tasks);
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
    setTasks([...tasks, data.task]);
    setNewTask("");
    setDueTime("");
    setShowForm(false);
  };

  const deleteTask = async (id: string) => {
    const confirmed = confirm("Are you sure you want to delete this task?");
    if (!confirmed) return;
    await fetch(`/api/tasks/${id}`, { method: "DELETE" });
    setTasks(tasks.filter((task) => task._id !== id));
  };

  useEffect(() => {
    fetchTasks();
    fetchDate();
  }, []);

  return (
    <div className="bg-gray-100 rounded-lg p-6 max-w-md mx-auto text-black">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold">Today’s Date: {dateInfo.date}</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="text-2xl text-blue-500 hover:text-blue-700"
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

      {tasks.map((task) => (
        <div
          key={task._id}
          className="flex justify-between items-center p-3 mb-2 rounded text-white"
          style={{ backgroundColor: task.color }}
        >
          <div>
            <div className="font-medium">{task.text}</div>
            <div className="text-sm">Due: {task.due}</div>
          </div>
          <button
            onClick={() => deleteTask(task._id!)}
            className="text-xl text-red-500 hover:text-red-700"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
