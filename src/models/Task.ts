
import mongoose from "mongoose";

const TaskSchema = new mongoose.Schema({
  text: { type: String, required: true },
  due: { type: String, required: true },
  color: { type: String, required: true },
});

export default mongoose.models.Task || mongoose.model("Task", TaskSchema);
