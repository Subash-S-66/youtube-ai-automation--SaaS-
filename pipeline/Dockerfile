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

# Use the Azure job runner entrypoint so token bootstrap/sync logic always runs in ACA Jobs.
ENTRYPOINT ["python", "-m", "youtube_ai_automation.azure_job_runner"]
