// src/components/TodoList.tsx
"use client";
import React, { useEffect, useState } from "react";
import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"], weight: ["400", "600", "700"] });

type Task = {
  _id?: string;
  text: string;
  due?: string;
  description?: string;
  color?: string;
  completed: boolean;
  date?: string; // "YYYY-MM-DD"
};

type DateInfo = { date: string };

export default function TodoList() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [newDescription, setNewDescription] = useState("");
  const [newTask, setNewTask] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [dateInfo, setDateInfo] = useState<DateInfo>({ date: "" });

  const pastelColors = [
    "#FFDEE9", "#B5FFFC", "#C9FFBF", "#FFD6A5", "#FEC5E5",
    "#D5AAFF", "#FFFACD", "#C1F0F6", "#FFB3BA", "#BAFFC9"
  ];

  const localISODate = (): string => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  };

  // Simple fetch - just get all tasks and let client categorize
  const fetchTasks = async () => {
    try {
      const res = await fetch("/api/tasks", { cache: "no-store" });
      if (!res.ok) {
        console.warn("fetchTasks failed:", res.status);
        return;
      }
      const data = await res.json();
      
      // Handle different response formats
      let allTasks: any[] = [];
      if (Array.isArray(data)) {
        allTasks = data;
      } else if (Array.isArray(data.tasks)) {
        allTasks = data.tasks;
      } else if (data.today || data.carryOver || data.completed) {
        // Merge all arrays if server returns buckets
        allTasks = [
          ...(Array.isArray(data.today) ? data.today : []),
          ...(Array.isArray(data.carryOver) ? data.carryOver : []),
          ...(Array.isArray(data.completed) ? data.completed : [])
        ];
      }

      // Normalize tasks
      const normalizedTasks: Task[] = allTasks.map((t: any) => ({
        _id: t._id || t.id,
        text: t.text || "",
        due: t.due || t.time || "",
        description: t.description || t.desc || "",
        color: t.color || pastelColors[Math.floor(Math.random() * pastelColors.length)],
        completed: !!t.completed,
        date: t.date || localISODate(),
      }));

      setTasks(normalizedTasks);
    } catch (err) {
      console.error("fetchTasks failed:", err);
    }
  };

  // Fetch date from server or use local
  const fetchDate = async () => {
    try {
      const base = process.env.NEXT_PUBLIC_API_URL;
      if (base) {
        const res = await fetch(`${base}/date`, { cache: "no-store" });
        if (res.ok) {
          const d = await res.json();
          setDateInfo({ date: d.date || formatLocalDate(new Date()) });
          return;
        }
      }
    } catch (err) {
      // Fallback to local date
    }
    setDateInfo({ date: formatLocalDate(new Date()) });
  };

  const formatLocalDate = (d: Date) =>
    d.toLocaleDateString("en-US", { 
      weekday: "long", 
      year: "numeric", 
      month: "long", 
      day: "numeric" 
    });

  // Simple add task - no complex logic
  const addTask = async () => {
    if (!newTask?.trim()) return;
    
    try {
      const taskData = {
        text: newTask.trim(),
        due: dueTime || "",
        description: newDescription || "",
        completed: false,
        date: localISODate(),
      };

      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(taskData),
      });

      if (!res.ok) {
        throw new Error(`Failed to create task: ${res.status}`);
      }

      const result = await res.json();
      const createdTask: Task = {
        ...taskData,
        _id: result._id || result.id || result.task?._id || result.task?.id,
        color: result.color || result.task?.color || pastelColors[Math.floor(Math.random() * pastelColors.length)],
      };

      // Add to local state immediately
      setTasks(prev => [createdTask, ...prev]);

      // Clear form
      setNewTask("");
      setNewDescription("");
      setDueTime("");
      setShowForm(false);

      // Optional: refetch after a short delay to sync with server
      setTimeout(fetchTasks, 500);
      
    } catch (err) {
      console.error("addTask failed:", err);
      alert("Failed to add task. Please try again.");
    }
  };

  // Simple delete
  const deleteTask = async (id?: string) => {
    if (!id) return;
    
    try {
      // Remove from UI immediately
      setTasks(prev => prev.filter(t => t._id !== id));
      
      // Delete from server
      const res = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
      if (!res.ok) {
        console.warn("Delete request failed:", res.status);
        // Refetch to restore state if delete failed
        fetchTasks();
      }
    } catch (err) {
      console.error("deleteTask failed:", err);
      fetchTasks(); // Restore state on error
    }
  };

  // Toggle completion status
  const toggleComplete = async (id?: string) => {
    if (!id) return;
    
    const task = tasks.find(t => t._id === id);
    if (!task) return;

    const updatedTask = { ...task, completed: !task.completed };
    
    try {
      // Update UI immediately
      setTasks(prev => prev.map(t => t._id === id ? updatedTask : t));
      
      // Update server
      const res = await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: updatedTask.completed }),
      });

      if (!res.ok) {
        console.warn("Toggle complete failed:", res.status);
        // Revert on error
        setTasks(prev => prev.map(t => t._id === id ? task : t));
      }
    } catch (err) {
      console.error("toggleComplete failed:", err);
      // Revert on error
      setTasks(prev => prev.map(t => t._id === id ? task : t));
    }
  };

  // Update task field with debounced save
  const updateTask = async (id: string, field: keyof Task, value: any) => {
    // Update UI immediately
    setTasks(prev => prev.map(t => 
      t._id === id ? { ...t, [field]: value } : t
    ));

    // Debounced save to server
    clearTimeout((window as any)[`save_${id}`]);
    (window as any)[`save_${id}`] = setTimeout(async () => {
      try {
        const res = await fetch(`/api/tasks/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [field]: value }),
        });
        if (!res.ok) {
          console.warn("Update task failed:", res.status);
        }
      } catch (err) {
        console.error("updateTask failed:", err);
      }
    }, 500);
  };

  // Move task up/down in the list
  const moveTask = (taskList: Task[], setTaskList: (tasks: Task[]) => void, index: number, direction: "up" | "down") => {
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= taskList.length) return;

    const newList = [...taskList];
    [newList[index], newList[newIndex]] = [newList[newIndex], newList[index]];
    setTaskList(newList);
  };

  useEffect(() => {
    fetchTasks();
    fetchDate();
  }, []);

  const formatTime = (time?: string) => {
    if (!time) return "";
    const [hhStr, mmStr] = time.split(":");
    const hh = Number(hhStr);
    const mm = Number(mmStr || 0);
    const hh12 = hh % 12 || 12;
    const ampm = hh >= 12 ? "PM" : "AM";
    return `${hh12}:${String(mm).padStart(2, "0")} ${ampm}`;
  };

  // Split tasks into categories
  const todayStr = localISODate();
  const todayTasks = tasks.filter(t => !t.completed && (t.date === todayStr || !t.date));
  const pastTasks = tasks.filter(t => !t.completed && t.date && t.date < todayStr);
  const completedTasks = tasks.filter(t => t.completed);

  // Sort by due time
  const sortByDue = (taskList: Task[]) => 
    taskList.sort((a, b) => (a.due || "").localeCompare(b.due || ""));

  // Render a single task
  const renderTask = (
    task: Task,
    index: number,
    taskList: Task[],
    setTaskList: (tasks: Task[]) => void,
    extras?: React.ReactNode
  ) => (
    <div
      key={task._id || `task-${index}`}
      className="flex justify-between items-start p-3 mb-2 rounded-md border border-gray-600 w-full"
      style={{ 
        backgroundColor: task.color || "#1E1E1E", 
        color: "#E6E6E6" 
      }}
    >
      <div className="flex-1 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <input
            type="text"
            value={task.text}
            onChange={(e) => updateTask(task._id!, "text", e.target.value)}
            className="font-medium text-sm text-gray-100 bg-transparent outline-none flex-1"
            placeholder="Task name"
          />
          {task.due && (
            <span className="ml-2 text-xs text-gray-400 whitespace-nowrap">
              {formatTime(task.due)}
            </span>
          )}
        </div>

        {task.description && (
          <textarea
            value={task.description}
            onChange={(e) => updateTask(task._id!, "description", e.target.value)}
            className="text-xs text-gray-300 w-full bg-transparent outline-none resize-none"
            placeholder="Description..."
            rows={2}
          />
        )}
      </div>

      <div className="flex items-center gap-2 ml-2">
        <button
          onClick={() => moveTask(taskList, setTaskList, index, "up")}
          className="text-sm text-gray-400 hover:text-gray-200"
        >
          ↑
        </button>
        <button
          onClick={() => moveTask(taskList, setTaskList, index, "down")}
          className="text-sm text-gray-400 hover:text-gray-200"
        >
          ↓
        </button>
        {extras}
      </div>
    </div>
  );

  return (
    <div className={`${inter.className} grid grid-cols-1 md:grid-cols-3 gap-6 p-6 items-start`}>
      
      {/* Past Tasks */}
      <section>
        <h3 className="text-md font-semibold text-white border border-gray-600 rounded-md py-2 px-3 text-center mb-3">
          Past Tasks ({pastTasks.length})
        </h3>
        {pastTasks.length === 0 ? (
          <p className="text-sm text-gray-500 text-center">No past tasks</p>
        ) : (
          sortByDue(pastTasks).map((task, index) =>
            renderTask(task, index, pastTasks, () => {}, (
              <>
                <input
                  type="checkbox"
                  checked={task.completed}
                  onChange={() => toggleComplete(task._id)}
                  className="w-4 h-4"
                />
                <button
                  onClick={() => updateTask(task._id!, "date", todayStr)}
                  className="text-xs text-blue-400 border border-blue-400 rounded px-2 py-1 hover:bg-blue-400 hover:text-white"
                >
                  Today
                </button>
                <button
                  onClick={() => deleteTask(task._id)}
                  className="text-lg text-gray-400 hover:text-red-500"
                >
                  ×
                </button>
              </>
            ))
          )
        )}
      </section>

      {/* Today's Tasks */}
      <main>
        <div className="text-md font-semibold text-white border border-gray-600 rounded-md py-2 px-3 text-center mb-3 flex items-center justify-between">
          <span>{dateInfo.date || formatLocalDate(new Date())}</span>
          <button
            onClick={() => setShowForm(!showForm)}
            className="text-xl text-gray-300 hover:text-white"
          >
            +
          </button>
        </div>

        {showForm && (
          <div className="mb-4 space-y-3 p-3 border border-gray-600 rounded-md bg-gray-800">
            <input
              type="text"
              placeholder="Task name"
              value={newTask}
              onChange={(e) => setNewTask(e.target.value)}
              className="w-full p-2 border border-gray-600 rounded bg-gray-700 text-gray-100"
            />
            <textarea
              placeholder="Description (optional)"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              className="w-full p-2 border border-gray-600 rounded bg-gray-700 text-gray-300"
              rows={2}
            />
            <input
              type="time"
              value={dueTime}
              onChange={(e) => setDueTime(e.target.value)}
              className="w-full p-2 border border-gray-600 rounded bg-gray-700 text-gray-100"
            />
            <div className="flex gap-2">
              <button
                onClick={addTask}
                className="flex-1 bg-blue-600 text-white p-2 rounded-md hover:bg-blue-700"
              >
                Add Task
              </button>
              <button
                onClick={() => setShowForm(false)}
                className="px-4 bg-gray-600 text-gray-200 p-2 rounded-md hover:bg-gray-700"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {todayTasks.length === 0 ? (
          <p className="text-sm text-gray-500 text-center">No tasks for today</p>
        ) : (
          sortByDue(todayTasks).map((task, index) =>
            renderTask(task, index, todayTasks, () => {}, (
              <>
                <input
                  type="checkbox"
                  checked={task.completed}
                  onChange={() => toggleComplete(task._id)}
                  className="w-4 h-4"
                />
                <button
                  onClick={() => deleteTask(task._id)}
                  className="text-lg text-gray-400 hover:text-red-500"
                >
                  ×
                </button>
              </>
            ))
          )
        )}
      </main>

      {/* Completed Tasks */}
      <section>
        <h3 className="text-md font-semibold text-white border border-gray-600 rounded-md py-2 px-3 text-center mb-3">
          Completed ({completedTasks.length})
        </h3>
        {completedTasks.length === 0 ? (
          <p className="text-sm text-gray-500 text-center">No completed tasks</p>
        ) : (
          completedTasks.slice(0, 10).map((task, index) => // Show only last 10 completed
            renderTask(task, index, completedTasks, () => {}, (
              <>
                <input
                  type="checkbox"
                  checked={task.completed}
                  onChange={() => toggleComplete(task._id)}
                  className="w-4 h-4"
                />
                <button
                  onClick={() => deleteTask(task._id)}
                  className="text-lg text-gray-400 hover:text-red-500"
                >
                  ×
                </button>
              </>
            ))
          )
        )}
      </section>
    </div>
  );
}