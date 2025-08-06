import { NextApiRequest, NextApiResponse } from "next";
import clientPromise from "@/lib/db";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const client = await clientPromise;
    const db = client.db("gmail_ai_analyzer"); // You can rename this to your actual DB name
    const tasksCollection = db.collection("tasks");

    if (req.method === "GET") {
      const tasks = await tasksCollection.find({}).toArray();
      return res.status(200).json({ tasks });
    }

    if (req.method === "POST") {
      const { text, due } = req.body;

      if (!text || !due) {
        return res.status(400).json({ error: "Missing task text or due date" });
      }

      const colors = ["#fde68a", "#bfdbfe", "#bbf7d0", "#fbcfe8", "#fcd34d"];
      const color = colors[Math.floor(Math.random() * colors.length)];

      const newTask = {
        text,
        due,
        color,
        createdAt: new Date(),
      };

      const result = await tasksCollection.insertOne(newTask);

      return res.status(201).json({ task: { ...newTask, _id: result.insertedId } });
    }

    return res.status(405).json({ error: "Method Not Allowed" });
  } catch (error) {
    console.error("Error in /api/tasks:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
