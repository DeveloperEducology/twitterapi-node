import winston from 'winston';
import 'winston-daily-rotate-file';
import path from 'path';
import fs from 'fs';

const { combine, timestamp, printf, colorize } = winston.format;

// Define the directory for logs
const logDir = 'logs';

// Create the log directory if it does not exist
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

// Custom log format for the console
const consoleLogFormat = combine(
  colorize(),
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  printf(({ level, message, timestamp }) => `${timestamp} ${level}: ${message}`)
);

// Custom log format for files
const fileLogFormat = combine(
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  printf(({ level, message, timestamp }) => `${timestamp} ${level}: ${message}`)
);

const logger = winston.createLogger({
  // Default level of logs to capture
  level: 'info',
  
  // Define transports (destinations) for the logs
  transports: [
    // 1. Console Transport: For development feedback
    new winston.transports.Console({
      format: consoleLogFormat,
    }),

    // 2. Daily Rotating File for all logs (info, warn, error)
    new winston.transports.DailyRotateFile({
      filename: path.join(logDir, 'combined-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true, // Compress old log files
      maxSize: '20m',      // Rotate if file size exceeds 20MB
      maxFiles: '14d',     // Keep logs for 14 days
      format: fileLogFormat,
    }),

    // 3. Daily Rotating File for only error logs
    new winston.transports.DailyRotateFile({
      filename: path.join(logDir, 'error-%DATE%.log'),
      level: 'error',      // Only log errors to this file
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: '30d',     // Keep error logs for 30 days
      format: fileLogFormat,
    }),
  ],
  exitOnError: false, // Do not exit on handled exceptions
});

export default logger;