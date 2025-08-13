import mongoose, { Schema, model, models } from "mongoose";

export interface Task {
  _id?: string;
  clientTempID?: string;
  text: string;
  due?: string;
  description?: string;
  color?: string;
  date?: string;
  completed?: boolean;
  carryOver?: boolean;
}

const TaskSchema = new Schema<Task>({
  text: { type: String, required: true },
  due: { type: String },
  color: { type: String },
  date: { type: String },
  description: { type: String},
  completed: { type: Boolean, default: false },
  carryOver: { type: Boolean, default: false }
});

export default models.Task || model<Task>("Task", TaskSchema);
