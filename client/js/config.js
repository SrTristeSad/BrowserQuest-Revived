define(['text!../config/config_build.json'],
function(build) {
    var currentPort = window.location.port ? parseInt(window.location.port, 10) : (window.location.protocol === 'https:' ? 443 : 80),
        config = {
            dev: {
                host: window.location.hostname,
                port: currentPort,
                dispatcher: false
            },
            build: JSON.parse(build)
        };

    return config;
});
