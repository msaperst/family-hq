FROM python:3.12-slim
WORKDIR /opt/bridge
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && useradd -u 10001 -m bridge
COPY --chown=bridge:bridge agent.py protocol.py ./
USER bridge
CMD ["python", "agent.py"]
