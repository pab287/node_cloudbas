module.exports = {
    apps: [
      {
        name: "app",
        script: "zkFailover.js",
        env: { PORT: 3069 },
        watch: false,
        restart_delay: 5000,
        max_memory_restart: "250M",
        exp_backoff_restart_delay: 100,
      },
    ]
}