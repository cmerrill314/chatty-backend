import { Application, json, urlencoded, Response, Request, NextFunction } from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import hpp from 'hpp';
import compression from 'compression';
import cookieSession from 'cookie-session';
import HTTP_STATUS from 'http-status-codes';
import 'express-async-errors';
import { config } from './config';
import { Server } from 'socket.io';
import { createClient } from 'redis';
import { createAdapter } from '@socket.io/redis-adapter';
import applicationRoutes from './routes';
import { CustomError, IErrorResponse } from './shared/globals/helpers/error-handler';
import Logger from 'bunyan';

const SERVER_PORT = 5000;
const log: Logger = config.createLogger('server'); //name server will be stamped for all errors that occur on setupServer.ts

export class ChattyServer {
	//variable to hold the express application instance
	private app: Application;

	//constructor to create the express application instance when the ChattyServer class is instantiated
	constructor(app: Application) {
		this.app = app;
	}

	//call these methods on start
	public start(): void {
		this.securityMiddleware(this.app);
		this.standardMiddleware(this.app);
		this.routeMiddleware(this.app);
		this.globalErrorHandler(this.app);
		this.startServer(this.app);
	}

	private securityMiddleware(app: Application): void {
		app.set('trust proxy', 1);

		app.use(
			cookieSession({
				name: 'session', //name of the session
				keys: [config.SECRET_KEY_ONE!, config.SECRET_KEY_TWO!],
				maxAge: 24 * 7 * 3600000, //when the cookie will expire
				secure: config.NODE_ENV !== 'development', //secure will be false in development mode
				sameSite: 'none' // comment this line when running the server locally
			})
		);

		app.use(
			cors({
				origin: config.CLIENT_URL,
				credentials: true,
				optionsSuccessStatus: 200, //required for internet explorer
				methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] //list the methods we will be using
			})
		);

		//hpp and helmet middleware just use default properties, so don't need to add individual values
		app.use(hpp());
		app.use(helmet());
	}

	private standardMiddleware(app: Application): void {
		app.use(compression());

		app.use(
			urlencoded({
				extended: true,
				limit: '50mb'
			})
		);

		app.use(
			json({
				limit: '50mb'
			})
		);
	}

	private routeMiddleware(app: Application): void {
		applicationRoutes(app);
	}

	private globalErrorHandler(app: Application): void {
		app.all('*', (req: Request, res: Response) => {
			res.status(HTTP_STATUS.NOT_FOUND).json({ message: `${req.originalUrl} not found` });
		});

		app.use((error: IErrorResponse, _req: Request, res: Response, next: NextFunction) => {
			log.error(error);
			if (error instanceof CustomError) {
				return res.status(error.statusCode).json(error.serializeErrors());
			}
			next();
		});
	}

	private async startServer(app: Application): Promise<void> {
		//if (!config.JWT_TOKEN) {
		//    throw new Error('JWT_TOKEN must be provided');
		//}
		try {
			const httpServer: http.Server = new http.Server(app);
			const socketIO: Server = await this.createSocketIO(httpServer);
			this.startHttpServer(httpServer);
			this.socketIOConnections(socketIO);
		} catch (error) {
			log.error(error);
		}
	}

	//setup SocketIO redis adapter
	private async createSocketIO(httpServer: http.Server): Promise<Server> {
		const io: Server = new Server(httpServer, {
			cors: {
				origin: config.CLIENT_URL,
				methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
			}
		});

		//all documentation here: https://www.npmjs.com/package/@socket.io/redis-adapter
		const pubClient = createClient({ url: config.REDIS_HOST });
		const subClient = pubClient.duplicate();
		await Promise.all([pubClient.connect(), subClient.connect()]);
		io.adapter(createAdapter(pubClient, subClient));
		return io;
	}

	private startHttpServer(httpServer: http.Server): void {
		log.info(`Worker with process id of ${process.pid} has started...`);
		log.info(`Server has started with process ${process.pid}`);
		httpServer.listen(SERVER_PORT, () => {
			log.info(`Server running on port ${SERVER_PORT}`);
		});
	}

	private socketIOConnections(io: Server): void {}
}
