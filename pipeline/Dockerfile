# Use the official Python 3.10 slim image as base
FROM python:3.10-slim

# Set the working directory
WORKDIR /app

# Install system dependencies if required by the pipeline (e.g. ffmpeg)
# RUN apt-get update && apt-get install -y ffmpeg

# Copy requirements and install python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application code
COPY src/ /app/src/

# Set PYTHONPATH so python can find the modules
ENV PYTHONPATH="/app/src"

# Run the main pipeline script
# Assuming Azure Container Apps Job will override this with args like:
# ["--userId=123", "--prompt=...", "--token=...", "--settings=..."]
ENTRYPOINT ["python", "-m", "youtube_ai_automation.main"]
