import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import searchRouter from './routes/search';

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/search', searchRouter);

app.get('/api/health', (_, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => console.log(`API listening on :${PORT}`));

export default app;
