// src/pages/api/tasks/index.ts
import { NextApiRequest, NextApiResponse } from "next";
import connectDB from "@/lib/db";
import Task from "@/models/Task";

function getLocalToday(): string {
  // YYYY-MM-DD in server's local timezone (avoids UTC shifting issues)
  try {
    return new Date().toLocaleDateString("en-CA");
  } catch {
    // Fallback if ICU not available
    return new Date().toISOString().split("T")[0];
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await connectDB();

  if (req.method === "GET") {
    try {
      // Selected date sent from the client (YYYY-MM-DD). If absent, default to today.
      const selectedDate = typeof req.query.date === "string" ? req.query.date : getLocalToday();
      const todayStr = getLocalToday();

      // ✅ Only when datviewing "today" do we upe DB to mark overdue tasks as carryOver.
      // Browsing other days must NEVER mutate state.
      if (selectedDate === todayStr) {
        await Task.updateMany(
          {
            completed: false,
            carryOver: false,
            // strictly before today
            date: { $lt: todayStr },
          },
          { $set: { carryOver: true } }
        );
      }

      // Query with precise filters instead of fetching everything
      const [todayTasks, carryOverTasks, completedTasks] = await Promise.all([
        Task.find({ completed: false, carryOver: false, date: selectedDate }),
        // backlog up to the selected date
        Task.find({ completed: false, carryOver: true, date: { $lte: selectedDate } }),
        Task.find({ completed: true }), // keep as-is; filter by date if you prefer
      ]);

      return res.status(200).json({
        today: todayTasks,
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
      const { text, due, description, date } = req.body;

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
        // ✅ store the exact YYYY-MM-DD string from the client (no conversions)
        date,
        completed: false,
        carryOver: false,
      });

      return res.status(201).json({ task });
    } catch (error) {
      console.error("POST /api/tasks error:", error);
      return res.status(500).json({ error: "Failed to create task" });
    }
  }

  return res.status(405).end();
}
