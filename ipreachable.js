const net = require("net");
function checkPortReachable(host, port, timeout = 2000) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        let settled = false;
        socket.on("connect", () => {
            if (!settled) {
                settled = true;
                resolve({ reachable: true, reason: "Connected" });
            }
            socket.destroy();
        });
        socket.on("error", (err) => {
            if (!settled) {
                settled = true;
                let reason = "error";
                if (err.code === "ECONNREFUSED") reason = "Refused";
                else if (err.code === "EHOSTUNREACH") reason = "Unreachable";
                else if (err.code === "ETIMEDOUT") reason = "Timeout";
                else if (err.code) reason = err.code.toLowerCase();

                resolve({ reachable: false, reason });
            }
            socket.destroy();
        });
        socket.setTimeout(timeout, () => {
            if (!settled) {
                settled = true;
                resolve({ reachable: false, reason: "Timeout" });
            }
            socket.destroy();
        });

        socket.connect(port, host);
    });
}

module.exports = { checkPortReachable };