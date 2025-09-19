// src/pages/api/tasks/[id].ts
import type { NextApiRequest, NextApiResponse } from "next";
import connectDB from "@/lib/db";
import Task from "@/models/Task";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await connectDB();
  const { id } = req.query;

  if (req.method === "DELETE") {
    await Task.findByIdAndDelete(id);
    return res.status(200).json({ message: "Task deleted" });
  }

  if (req.method === "PATCH") {
    const { completed, carryOver, date, repeating, completeForDate } = req.body;
    const updateData: any = {};

    if (completed !== undefined) updateData.completed = completed;
    if (carryOver !== undefined) updateData.carryOver = carryOver;
    if (date !== undefined) updateData.date = date;
    if (repeating !== undefined) updateData.repeating = repeating;

    if (completeForDate) {
      // ✅ per-date completion for repeating tasks
      const task = await Task.findById(id);
      if (task) {
        const already = task.completedDates || [];
        if (!already.includes(completeForDate)) {
          task.completedDates = [...already, completeForDate];
          await task.save();
        }
        return res.status(200).json({ task });
      }
    } else {
      const updated = await Task.findByIdAndUpdate(id, updateData, { new: true });
      return res.status(200).json({ task: updated });
    }
  }
}
