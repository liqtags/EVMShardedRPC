import express from 'express';
import { rateLimit } from "express-rate-limit";
import { RPC_METHODS, JSON_RETURN_RESULT } from './RPC_METHODS';

// This is to stop people from abusing the RPC
const limiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  limit: 10, // each IP can make up to 10 requests per `windowsMs` (5 minutes)
  standardHeaders: true, // add the `RateLimit-*` headers to the response
  legacyHeaders: false, // remove the `X-RateLimit-*` headers from the response
});

const startExpressServer = async () => {
  const app = express();
  const port = 3000;
  
  app.use(limiter);
  app.use(express.json());

  app.post('/', (req: any, res: any) => {
    res.send('POST request to the homepage');
  });

  app.post('/evm_rpc/:shard', async (req: any, res: any) => {
    let shard = req.params.shard;
    let body = req.body;

    if (!body) {
      res.status(400).send('Invalid request');
    }

    if (body.jsonrpc === '2.0' && typeof body.method === 'string' && Array.isArray(body.params)) {
      if (RPC_METHODS.has(body.method)) {
        let result = await RPC_METHODS.get(body.method)(body.params,shard)
        if(result.error) {
          return res.status(400).send(result.error);
        } else {
          res.json(JSON_RETURN_RESULT(result, body.id));
        }
      } else {
        res.status(400).send('Method not found');
      }
    } else {
      res.status(400).send('Invalid request');
    }
  });

  // error handler
  app.use((err: any, req: any, res: any, next: any) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
  });

  // 404 handler
  app.use((req: any, res: any, next: any) => {
    res.status(404).send("Sorry can't find that!")
  });

  app.listen(port, () => {
    console.log(`Example app listening at http://localhost:${port}`);
  });
}

startExpressServer();