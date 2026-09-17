import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import { config } from './config';
import authRoutes from './routes/auth';
import documentRoutes from './routes/documents';
import analysisRoutes from './routes/analysis';
import samplesRoutes from './routes/samples';
import centresRoutes from './routes/centres';
import translateRoutes from './routes/translate';
import { paddleOCR } from './services/extractionService';
import logger from './services/logger';

const app = express();

if (config.nodeEnv === 'production') {
  app.set('trust proxy', 1);
}

// â”€â”€â”€ Security Headers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

// â”€â”€â”€ CORS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.use(
  cors({
    origin: config.cors.origin,
    credentials: true,
  })
);

// â”€â”€â”€ Body Parsers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// â”€â”€â”€ HTTP Request Logging â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.use(
  morgan(
    '[:date[iso]] :method :url :status :res[content-length] - :response-time ms',
    {
      stream: {
        write: (msg: string) => logger.http(msg.trim()),
      },
    }
  )
);

// â”€â”€â”€ Rate Limiters â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: config.nodeEnv === 'production' ? 20 : 200,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    error:
      'Too many failed authentication attempts. Please try again in 15 minutes.',
  },
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: config.nodeEnv === 'production' ? 20 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error:
      'Upload limit reached. Please wait before uploading more documents.',
  },
});

const analysisLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: config.nodeEnv === 'production' ? 10 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error:
      'Analysis limit reached. Please wait before running another analysis.',
  },
});

// â”€â”€â”€ Healthcheck â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    environment: config.nodeEnv,
  });
});

// â”€â”€â”€ System Status (OCR readiness) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/v1/status', (_req, res) => {
  res.json({
    geminiConfigured: Boolean(config.gemini.apiKey),
    ocrFallbackReady: paddleOCR.isReady(),
    ocrFallbackMode: config.extraction.paddleWarmupOnStart
      ? 'warm'
      : 'lazy',
    environment: config.nodeEnv,
  });
});

// â”€â”€â”€ Routes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.use('/api/v1/auth', authLimiter, authRoutes);
app.use('/api/v1/documents', uploadLimiter, documentRoutes);
app.use('/api/v1/analysis', analysisLimiter, analysisRoutes);
app.use('/api/v1/samples', samplesRoutes);
app.use('/api/v1/centres', centresRoutes);
const translateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: config.nodeEnv === 'production' ? 60 : 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many translation requests. Please slow down.' },
});

app.use('/api/v1/translate', translateLimiter, translateRoutes);

// â”€â”€â”€ 404 Handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.use((_req, res) => {
  res.status(404).json({
    error: 'Route not found',
  });
});

// â”€â”€â”€ Error Handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.use(
  (
    err: any,
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    logger.error(err?.message || 'Unhandled application error', {
      stack: err?.stack,
      path: req.path,
      method: req.method,
    });

    if (
      err?.message &&
      (err.message.startsWith('Invalid file type') ||
        err.message.includes('accepted'))
    ) {
      res.status(400).json({
        error: err.message,
      });
      return;
    }

    if (err?.type === 'entity.too.large') {
      res.status(413).json({
        error: `File too large. Maximum file size is ${config.upload.maxFileSizeMb} MB.`,
      });
      return;
    }

    res.status(500).json({
      error: 'Internal Server Error',
    });
  }
);

export { authLimiter, uploadLimiter, analysisLimiter };
export default app;
