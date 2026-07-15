import mongoose from "mongoose";
import dns from "dns";
import dotenv from "dotenv";

dotenv.config();

// Some local dev machines (observed on Windows) have a local DNS resolver at
// 127.0.0.1 that refuses SRV-type queries, even though normal A/AAAA lookups
// and the OS's own resolver work fine. That breaks mongodb+srv:// connection
// strings specifically, with no fault in the code or the Atlas cluster itself.
// This is a workaround for that local resolver quirk, not a general
// requirement - it's opt-in via DNS_WORKAROUND so it never silently masks a
// real DNS/network problem elsewhere.
if (process.env.DNS_WORKAROUND === "true") {
	dns.setServers(["8.8.8.8", "1.1.1.1"]);
}

export const connectDB = async () => {
	try {
		const conn = await mongoose.connect(process.env.MONGO_URI);
		console.log(`MongoDB connected: ${conn.connection.host}`);
	} catch (error) {
		console.log("Error connecting to MONGODB", error.message);
		process.exit(1);
	}
};
