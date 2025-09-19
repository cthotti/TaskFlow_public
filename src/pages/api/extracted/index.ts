import { NextApiRequest, NextApiResponse } from "next";
import connectDB from "@/lib/db";
import ExtractedTask from "@/models/ExtractedTasks";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await connectDB();

  if (req.method === "GET") {
    const tasks = await ExtractedTask.find({});
    return res.status(200).json(tasks);
  }

  if (req.method === "POST") {
    const { title, description, date, time, source_subject, source_from, confidence } = req.body;
    const task = await ExtractedTask.create({ title, description, date, time, source_subject, source_from, confidence });
    return res.status(201).json(task);
  }

  if (req.method === "PATCH") {
    const { id, addedToCalendar } = req.body;
    const task = await ExtractedTask.findByIdAndUpdate(id, { addedToCalendar }, { new: true });
    return res.status(200).json(task);
  }

  if (req.method === "DELETE") {
    const { id } = req.query;
    await ExtractedTask.findByIdAndDelete(id);
    return res.status(200).json({ message: "Deleted" });
  }

  return res.status(405).end();
}
