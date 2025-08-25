// src/components/Calendar.tsx
"use client";
import React, { ReactElement, useEffect, useState } from "react";
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
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth());

  // Fetch tasks once
  useEffect(() => {
    const fetchAll = async () => {
      const res = await fetch(
        "/api/tasks?date=" + new Date().toISOString().split("T")[0]
      );
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

  // Render current month
  const renderMonth = (month: number) => {
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const weeks: ReactElement[] = [];
    let day = 1 - firstDay;

    for (let row = 0; row < 6; row++) {
      const cells: ReactElement[] = [];
      for (let col = 0; col < 7; col++) {
        const dateStr =
          day > 0 && day <= daysInMonth
            ? `${year}-${String(month + 1).padStart(2, "0")}-${String(
                day
              ).padStart(2, "0")}`
            : "";

        const dayTasks = dateStr ? tasksForDate(dateStr) : [];

        cells.push(
          <td
            key={col}
            className={`w-32 h-28 align-top border border-gray-600 cursor-pointer ${
              dateStr === selectedDate ? "bg-green-700" : "hover:bg-gray-800"
            }`}
            onClick={() => dateStr && setSelectedDate(dateStr)}
          >
            <div className="flex flex-col items-start px-1">
              {day > 0 && day <= daysInMonth ? (
                <>
                  <span className="text-sm font-semibold">{day}</span>
                  {dayTasks.slice(0, 3).map((t) => (
                    <span
                      key={t._id}
                      className="text-[11px] truncate max-w-[90%] text-gray-300"
                      title={t.text}
                    >
                      {t.text}
                    </span>
                  ))}
                  {dayTasks.length > 3 && (
                    <span className="text-[11px] text-gray-500">
                      +{dayTasks.length - 3}
                    </span>
                  )}
                </>
              ) : null}
            </div>
          </td>
        );
        day++;
      }
      weeks.push(<tr key={row}>{cells}</tr>);
    }

    return (
      <div key={month} className="mb-8">
        <table className="w-full border-collapse text-sm table-fixed">
          <thead>
            <tr className="text-gray-400">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                <th key={d} className="w-32 text-center py-2">
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{weeks}</tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="max-w-6xl mx-auto text-white">
      {/* Title row */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() =>
            setCurrentMonth((prev) => (prev === 0 ? 11 : prev - 1))
          }
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded"
        >
          ← Prev
        </button>
        <h2 className="text-3xl font-bold">
          {new Date(year, currentMonth).toLocaleString("default", {
            month: "long",
          })}{" "}
          {year}
        </h2>
        <button
          onClick={() =>
            setCurrentMonth((prev) => (prev === 11 ? 0 : prev + 1))
          }
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded"
        >
          Next →
        </button>
      </div>

      {/* Show current month */}
      {renderMonth(currentMonth)}
    </div>
  );
}
