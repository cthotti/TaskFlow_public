// src/pages/api/tasks/index.ts
import { NextApiRequest, NextApiResponse } from "next";
import connectDB from "@/lib/db";
import Task from "@/models/Task";

function getLocalToday(): string {
  try {
    return new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD
  } catch {
    return new Date().toISOString().split("T")[0];
  }
}

function daysBetween(a: string, b: string) {
  // a,b: YYYY-MM-DD
  const da = new Date(a + "T00:00:00");
  const db = new Date(b + "T00:00:00");
  const diff = Math.round((db.getTime() - da.getTime()) / (1000 * 60 * 60 * 24));
  return diff;
}

function repeatingAppliesOnDate(repeating: any | undefined, targetDate: string) {
  if (!repeating || !repeating.enabled) return false;
  const type = repeating.type;
  const start = repeating.startDate ?? targetDate; // fallback
  if (type === "daily") return true;
  if (type === "everyOther") {
    // daysBetween(start, targetDate) % 2 === 0
    const diff = daysBetween(start, targetDate);
    return diff >= 0 && diff % 2 === 0;
  }
  if (type === "weekly") {
    const weekday = new Date(targetDate + "T00:00:00").getDay(); // 0..6
    return Array.isArray(repeating.days) && repeating.days.includes(weekday);
  }
  return false;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await connectDB();

  if (req.method === "GET") {
    try {
      const selectedDate = typeof req.query.date === "string" ? req.query.date : getLocalToday();
      const todayStr = getLocalToday();

      // Only mutate DB carryOver status when the client is asking for "today" view
      if (selectedDate === todayStr) {
        await Task.updateMany(
          {
            completed: false,
            carryOver: false,
            date: { $lt: todayStr },
          },
          { $set: { carryOver: true } }
        );
      }

      // Query non-repeating tasks for selectedDate (sorted by time)
      const [todayTasksPlain, carryOverTasks, completedTasks, candidateRepeating] = await Promise.all([
        Task.find({ completed: false, carryOver: false, date: selectedDate }).sort({ due: 1 }),
        Task.find({ completed: false, carryOver: true, date: { $lte: selectedDate } }).sort({ due: 1 }),
        Task.find({ completed: true }).sort({ due: 1 }),
        // find repeating tasks that are enabled; we'll filter in JS to avoid mistakes
        Task.find({ "repeating.enabled": true, completed: false }).sort({ due: 1 }),
      ]);


      // Filter repeating tasks that should display on selectedDate.
      const repeatingForDate = (candidateRepeating || []).filter((t: any) =>
        repeatingAppliesOnDate(t.repeating, selectedDate)
      );

      // Avoid duplicates: if a repeating task also has date === selectedDate and not carryOver then it could appear twice.
      // We'll merge repeating tasks into todayTasksPlain only if not already present.
      const existingIds = new Set((todayTasksPlain || []).map((t: any) => String(t._id)));
      const repeatingToAdd = repeatingForDate.filter((t: any) => !existingIds.has(String(t._id)));

      const finalToday = [...(todayTasksPlain || []), ...repeatingToAdd];

      return res.status(200).json({
        today: finalToday,
        carryOver: carryOverTasks,
        completed: completedTasks,
      });
    } catch (error) {
      console.error("GET /api/tasks error:", error);
      return res.status(500).json({ error: "Failed to fetch tasks" });
    }
  }

  if (req.method === "POST") {
    try {
      const { text, due, description, date, repeating } = req.body;

      if (!text || !date) {
        return res.status(400).json({ error: "Task text and date are required" });
      }

      const colors = ["#8C8C8C"];
      const color = colors[Math.floor(Math.random() * colors.length)];

      const task = await Task.create({
        text,
        description: description ?? "",
        due,
        color,
        date, // store exact YYYY-MM-DD from client
        completed: false,
        carryOver: false,
        repeating: repeating ?? { enabled: false },
      });

      return res.status(201).json({ task });
    } catch (error) {
      console.error("POST /api/tasks error:", error);
      return res.status(500).json({ error: "Failed to create task" });
    }
  }

  return res.status(405).end();
}
