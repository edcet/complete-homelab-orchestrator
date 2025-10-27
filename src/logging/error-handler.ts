/**
 * Error Logging and Handling System
 * Centralized error management for homelab orchestrator
 * Related to issue #1 - Complete Homelab Orchestrator
 */

export enum ErrorLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
  FATAL = 'FATAL'
}

export interface ErrorLog {
  level: ErrorLevel;
  message: string;
  timestamp: Date;
  stack?: string;
  context?: Record<string, any>;
}

export class ErrorHandler {
  private logs: ErrorLog[] = [];

  log(level: ErrorLevel, message: string, error?: Error, context?: Record<string, any>): void {
    const errorLog: ErrorLog = {
      level,
      message,
      timestamp: new Date(),
      stack: error?.stack,
      context
    };
    this.logs.push(errorLog);
    this.outputLog(errorLog);
  }

  private outputLog(log: ErrorLog): void {
    const logMessage = `[${log.timestamp.toISOString()}] ${log.level}: ${log.message}`;
    console.log(logMessage);
  }

  getLogs(level?: ErrorLevel): ErrorLog[] {
    if (level) {
      return this.logs.filter(log => log.level === level);
    }
    return this.logs;
  }

  clearLogs(): void {
    this.logs = [];
  }
}
