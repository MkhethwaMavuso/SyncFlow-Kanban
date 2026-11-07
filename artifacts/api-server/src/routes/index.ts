import { Router, type IRouter } from "express";
import analyticsRouter from "./analytics";
import authRouter from "./auth";
import boardsRouter from "./boards";
import healthRouter from "./health";
import sprintsRouter from "./sprints";
import tasksRouter from "./tasks";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(boardsRouter);
router.use(tasksRouter);
router.use(sprintsRouter);
router.use(analyticsRouter);

export default router;
