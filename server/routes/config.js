/**
 * Public configuration endpoint.
 * Returns which optional integrations are configured, so the client UI can
 * show friendly "not configured" notices instead of broken buttons.
 */
import express from 'express';
import { getServiceStatus } from '../config/secrets.js';

const router = express.Router();

router.get('/', (_req, res) => {
  res.json({
    status: getServiceStatus(),
    version: '1.0.0',
  });
});

export default router;
