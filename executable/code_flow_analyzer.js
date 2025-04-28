function analyzeCodeFlow(app) {
    const routes = [];

    app._router.stack.forEach((middleware) => {
        if (middleware.route) {
            // Routes registered directly on the app
            const method = Object.keys(middleware.route.methods)[0].toUpperCase();
            const path = middleware.route.path;
            routes.push({ method, path });
        } else if (middleware.name === 'router') {
            // Router middleware
            middleware.handle.stack.forEach((handler) => {
                if (handler.route) {
                    const method = Object.keys(handler.route.methods)[0].toUpperCase();
                    const path = handler.route.path;
                    routes.push({ method, path });
                }
            });
        }
    });

    return routes;
}

module.exports = { analyzeCodeFlow };
