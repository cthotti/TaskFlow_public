"use client";
import React, { ReactNode, ReactElement } from "react";
import { useEffect, useState } from "react";
import { useTaskContext } from "@/context/TaskContext";

type Task = {
  _id: string;
  text: string;
  date: string;
};

export default function Calendar() {
  const { selectedDate, setSelectedDate } = useTaskContext();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [year] = useState(new Date().getFullYear());

  // Fetch tasks to show indicators in calendar
  useEffect(() => {
    const fetchAll = async () => {
      const res = await fetch("/api/tasks");
      const data = await res.json();
      const allTasks = [
        ...(data.today ?? []),
        ...(data.carryOver ?? []),
        ...(data.completed ?? []),
      ];
      setTasks(allTasks);
    };
    fetchAll();
  }, []);

  // Helper: get tasks for a specific date
  const tasksForDate = (dateStr: string) =>
    tasks.filter((t) => t.date?.startsWith(dateStr));

  // Render days in a month
  const renderMonth = (month: number) => {
    const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const weeks: ReactElement[] = [];
    let day = 1 - firstDay;

    for (let row = 0; row < 6; row++) {
      const cells: ReactElement[] = [];
      for (let col = 0; col < 7; col++) {
        const dateStr =
          day > 0 && day <= daysInMonth
            ? `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
            : "";

        const dayTasks = dateStr ? tasksForDate(dateStr) : [];

        cells.push(
          <td
            key={col}
            className={`w-12 h-12 text-center border border-gray-700 cursor-pointer ${
              dateStr === selectedDate ? "bg-green-700" : "hover:bg-gray-800"
            }`}
            onClick={() => dateStr && setSelectedDate(dateStr)}
          >
            {day > 0 && day <= daysInMonth ? (
              <div className="flex flex-col items-center">
                <span>{day}</span>
                {dayTasks.slice(0, 2).map((t) => (
                  <span key={t._id} className="text-[10px] truncate text-gray-300">
                    {t.text}
                  </span>
                ))}
                {dayTasks.length > 2 && (
                  <span className="text-[10px] text-gray-500">+{dayTasks.length - 2}</span>
                )}
              </div>
            ) : null}
          </td>
        );
        day++;
      }
      weeks.push(<tr key={row}>{cells}</tr>);
    }

    return (
      <div key={month} className="mb-8">
        <h3 className="text-center text-lg font-semibold mb-2">
          {new Date(year, month).toLocaleString("default", { month: "long" })}
        </h3>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-gray-400">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                <th key={d} className="w-12">{d}</th>
              ))}
            </tr>
          </thead>
          <tbody>{weeks}</tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="max-w-5xl mx-auto text-white">
      <h2 className="text-2xl text-center mb-6">{year}</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {Array.from({ length: 12 }, (_, i) => renderMonth(i))}
      </div>
    </div>
  );
}
