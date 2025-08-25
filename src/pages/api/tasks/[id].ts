import type { NextApiRequest, NextApiResponse } from "next";
import connectDB from "@/lib/db";
import Task from "models/Task";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await connectDB();
  const { id } = req.query;

  if (req.method === "DELETE") {
    await Task.findByIdAndDelete(id);
    return res.status(200).json({ message: "Task deleted" });
  }

  if (req.method === "PATCH") {
    const { completed, carryOver, date } = req.body;
    const updateData: any = {};

    if (completed !== undefined) updateData.completed = completed;
    if (carryOver !== undefined) updateData.carryOver = carryOver;

    // ✅ If moving task back to today, use provided date (from frontend TaskContext)
    if (carryOver === false && date) {
      updateData.date = date;
    }

    const updated = await Task.findByIdAndUpdate(id, updateData, { new: true });
    return res.status(200).json({ task: updated });
  }
}
