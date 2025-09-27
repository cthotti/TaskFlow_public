# list_models_example.py
import os
import pprint
import google.generativeai as genai

API_KEY = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
if not API_KEY:
    raise RuntimeError("Set GEMINI_API_KEY or GOOGLE_API_KEY in env")

# configure client (function present in official package)
genai.configure(api_key=API_KEY)

# genai.list_models() returns an iterator/generator — convert to list
models = list(genai.list_models())
pprint.pprint(models)   # prints Python objects nicely

# If you need JSON:
import json
print(json.dumps(models, default=str, indent=2))  # default=str for any non-serializable fields
