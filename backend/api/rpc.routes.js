

import { Router } from 'express';
import { createRpcHandler } from '../kernel/rpc.js';

export function createRpcRoute({ rpcHandler }) {
  const router = Router();
  router.post('/', async (req, res) => {
    const response = await rpcHandler.handle(req.body, req.auth);
    res.json(response);
  });
  return router;
}