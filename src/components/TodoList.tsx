"use client";
import { useEffect, useState } from "react";
import { Task } from "models/Task";

type DateInfo = {
  date: string;
};

export default function TodoList() {
  const [carryOverTasks, setCarryOverTasks] = useState<Task[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [completedTasks, setCompletedTasks] = useState<Task[]>([]);

  const [showForm, setShowForm] = useState(false);
  const [newTask, setNewTask] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [dateInfo, setDateInfo] = useState<DateInfo>({ date: "" });

  const sortTasksByTime = (tasksArray: Task[]) => {
    return [...tasksArray].sort((a, b) => {
      if (!a.due) return 1;
      if (!b.due) return -1;
      return a.due.localeCompare(b.due);
    });
  };

  const fetchTasks = async () => {
    const res = await fetch("/api/tasks");
    const data = await res.json();
    setCarryOverTasks(data.carryOver || []);
    setTasks(sortTasksByTime(data.today || []));
    setCompletedTasks(data.completed || []);
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
    setCarryOverTasks(carryOverTasks.filter((task) => task._id !== id));
  };

  const completeTask = async (id: string) => {
    const res = await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed: true }),
    });
    const updated = await res.json();
    setTasks(tasks.filter((t) => t._id !== id));
    setCompletedTasks([...completedTasks, updated.task]);
  };

  const moveToToday = async (id: string) => {
    const res = await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ carryOver: false }),
    });
    const updated = await res.json();
    setCarryOverTasks(carryOverTasks.filter((t) => t._id !== id));
    setTasks(sortTasksByTime([...tasks, updated.task]));
  };

  const moveTaskUp = (index: number) => {
    if (index === 0) return;
    const updatedTasks = [...tasks];
    [updatedTasks[index - 1], updatedTasks[index]] = [
      updatedTasks[index],
      updatedTasks[index - 1],
    ];
    setTasks(updatedTasks);
  };

  const moveTaskDown = (index: number) => {
    if (index === tasks.length - 1) return;
    const updatedTasks = [...tasks];
    [updatedTasks[index + 1], updatedTasks[index]] = [
      updatedTasks[index],
      updatedTasks[index + 1],
    ];
    setTasks(updatedTasks);
  };

  useEffect(() => {
    fetchTasks();
    fetchDate();
  }, []);

  return (
    <div className="flex justify-between max-w-5xl mx-auto gap-6 text-black">
      {/* Carry Over Tasks */}
      <div className="bg-gray-100 rounded-lg p-4 w-1/3">
        <h3 className="text-lg font-semibold mb-4">Carry Over Tasks</h3>
        {carryOverTasks.map((task) => (
          <div key={task._id} className="flex justify-between items-center p-3 mb-2 rounded bg-yellow-200">
            <div>
              <div className="font-semibold text-lg">{task.text}</div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => moveToToday(task._id!)} className="px-2 py-1 bg-green-500 text-white rounded">
                Add
              </button>
              <button onClick={() => deleteTask(task._id!)} className="text-red-500 text-xl">×</button>
            </div>
          </div>
        ))}
      </div>

      {/* Today's Tasks */}
      <div className="bg-gray-100 rounded-lg p-4 w-1/3">
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-xl font-semibold">{dateInfo.date}</h2>
          <button onClick={() => setShowForm(!showForm)} className="text-3xl text-blue-500 hover:text-blue-700">
            +
          </button>
        </div>

        {showForm && (
          <div className="mb-4 space-y-2">
            <input type="text" placeholder="Task" value={newTask} onChange={(e) => setNewTask(e.target.value)} className="w-full p-2 border rounded" />
            <input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} className="w-full p-2 border rounded" />
            <button onClick={addTask} className="w-full bg-blue-500 hover:bg-blue-600 text-white p-2 rounded">
              Add Task
            </button>
          </div>
        )}

        {tasks.map((task, index) => (
          <div key={task._id} className="flex justify-between items-center p-3 mb-2 rounded bg-orange-200">
            <div>
              <div className="font-semibold text-lg">{task.text}</div>
              <div className="text-md">Due: {task.due}</div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => moveTaskUp(index)}>↑</button>
              <button onClick={() => moveTaskDown(index)}>↓</button>
              <button onClick={() => deleteTask(task._id!)}>×</button>
              <input type="checkbox" onChange={() => completeTask(task._id!)} />
            </div>
          </div>
        ))}
      </div>

      {/* Completed Tasks */}
      <div className="bg-gray-100 rounded-lg p-4 w-1/3">
        <h3 className="text-lg font-semibold mb-4">Completed Tasks</h3>
        {completedTasks.map((task) => (
          <div key={task._id} className="p-3 mb-2 rounded bg-green-200">
            <div className="font-semibold text-lg">{task.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
