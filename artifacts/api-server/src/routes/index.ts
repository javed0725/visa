import { Router, type IRouter } from "express";
import healthRouter from "./health";
import phoneOTPRouter from "./phone-otp";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/phone-otp", phoneOTPRouter);

export default router;
