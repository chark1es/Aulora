FROM python:3.13-alpine
WORKDIR /app
COPY infra/docker/smtp-gateway/server.py /app/server.py
USER 65532:65532
EXPOSE 8787
CMD ["python", "/app/server.py"]
