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

      const [todayTasksPlain, carryOverTasks, completedTasks, candidateRepeating] = await Promise.all([
        Task.find({ completed: false, carryOver: false, date: selectedDate }).sort({ due: 1 }),
        Task.find({ completed: false, carryOver: true, date: { $lte: selectedDate } }).sort({ due: 1 }),
        Task.find({ completed: true }).sort({ due: 1 }),
        Task.find({ "repeating.enabled": true, completed: false }).sort({ due: 1 }),
      ]);


      const repeatingForDate = (candidateRepeating || []).filter((t: any) =>
        repeatingAppliesOnDate(t.repeating, selectedDate)
      );

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
        date, 
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
