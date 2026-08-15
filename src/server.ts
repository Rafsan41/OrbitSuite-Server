import dotenv from "dotenv";
dotenv.config();
import app from "./app.js";

// Start the server

const boostrap = async () => {
    try {
        app.listen(process.env.PORT, () => {
            console.log(`Server is running on http://localhost:${process.env.PORT}`);
        });

    } catch (error) {
        console.log(error);
    }
}
boostrap();