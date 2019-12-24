// Homebridge plugin for Home Connect home appliances
// Copyright © 2019 Alexander Thoukydides

'use strict';

const EventEmitter = require('events');
const request = require('request');
const requestPromise = require('request-promise-native');
const url = require('url');
const querystring = require('querystring');

// URLs for the Home Connect API
const URL_LIVE = 'https://api.home-connect.com';
const URL_SIMULATOR = 'https://simulator.home-connect.com';

// Scopes to request; an additional Partner Agreement is required for:
//   Hob-Control, Oven-Control, and FridgeFreezer-Images
// The Home Connect simulator additionally disallows:
//   CookProcessor-Control and FridgeFreezer-Control
const SCOPES = ['IdentifyAppliance', 'Monitor', 'Settings',
                'CleaningRobot-Control', 'CoffeeMaker-Control',
                'Dishwasher-Control', 'Dryer-Control', 'Freezer-Control',
                'Hood-Control', 'Refrigerator-Control', 'Washer-Control',
                'WasherDryer-Control', 'WineCooler-Control'];

// Expanded help text for problems with the Client ID
const CLIENT_HELP_PREFIX1 = 'Unable to authorize Home Connect application; ';
const CLIENT_HELP_PREFIX2 = '. Visit https://developer.home-connect.com/applications to ';
const CLIENT_HELP_EXTRA = {
    'request rejected by client authorization authority (developer portal)':
        'register an application and then copy its Client ID.',
    'client not authorized for this oauth flow (grant_type)':
        "register a new application, ensuring that the 'OAuth Flow' is set to 'Device Flow' (this setting cannot be changed after the application has been created).",
    'client has no redirect URI defined':
        "edit the application (or register a new one) to set a 'Success Redirect' web page address.",
    'client has limited user list - user not assigned to client':
        "edit the application (or register a new one) to set the 'Home Connect User Account for Testing' to match the one being authorized."
};

// Interval between authorization retries
const AUTH_RETRY_DELAY    = 60; // (seconds)
const REFRESH_RETRY_DELAY = 5;  // (seconds)

// Time before expiry of access token to request refresh
const TOKEN_REFRESH_WINDOW = 60 * 60; // (seconds)

const MS = 1000;
                  
// Low-level access to the Home Connect API
module.exports = class HomeConnectAPI extends EventEmitter {

    // Create a new API object
    constructor(log, clientID, simulator, savedAuth) {
        super();
        
        // Store the options, applying defaults for missing options
        this.clientID = clientID;
        this.simulator = simulator || false;
        this.savedAuth = savedAuth || {};

        // Logging
        this.log = log || console.log;
        this.requestCount = 0;

        // Select the appropriate API
        this.url = simulator ? URL_SIMULATOR : URL_LIVE;

        // Pending promises
        this.authResolve = [];
        this.sleepReject = {};
        this.streamAbort = {};

        // Rate limiting
        this.earliestRetry = Date.now();

        // Obtain and maintain an access token
        this.authorizeClient();
    }

    // Get a list of paired home appliances
    async getAppliances() {
        let data = await this.requestAppliances('GET');
        return data && data.homeappliances;
    }

    // Get details of a specific paired home appliances
    getAppliance(haid) {
       return this.requestAppliances('GET', haid);
    }

    // Get the program which is currently being executed (throws error if none)
    getActiveProgram(haid) {
        return this.requestAppliances('GET', haid, '/programs/active');
    }

    // Start a specified program
    setActiveProgram(haid, programKey, options) {
        return this.requestAppliances('PUT', haid, '/programs/active', {
            data: {
                key:      programKey,
                options:  options
            }
        });
    }

    // Stop the active program
    stopActiveProgram(haid) {
        return this.requestAppliances('DELETE', haid, '/programs/active');
    }

    // Get the program which is currently selected
    getSelectedProgram(haid) {
        return this.requestAppliances('GET', haid, '/programs/selected');
    }

    // Select a program
    setSelectedProgram(haid, programKey, options) {
        return this.requestAppliances('PUT', haid, '/programs/selected', {
            data: {
                key:      programKey,
                options:  options
            }
        });
    }

    // Get a list of the available programs
    async getAvailablePrograms(haid) {
        let data = await this.requestAppliances('GET', haid,
                                                '/programs/available');
        return data.programs;
    }

    // Get the details of a specific available programs
    getAvailableProgram(haid, programKey) {
        return this.requestAppliances('GET', haid,
                                      '/programs/available/' + programKey);
    }

    // Get the current status
    async getStatus(haid) {
        let data = await this.requestAppliances('GET', haid, '/status');
        return data.status;
    }

    // Get a specific status
    getStatusSpecific(haid, statusKey) {
        return this.requestAppliances('GET', haid, '/status' + '/' + statusKey);
    }

    // Get all settings
    async getSettings(haid) {
        let data = await this.requestAppliances('GET', haid, '/settings');
        return data.settings;
    }

    // Get a specific setting
    getSetting(haid, settingKey) {
        return this.requestAppliances('GET', haid, '/settings/' + settingKey);
    }

    // Set a specific setting
    setSetting(haid, settingKey, value) {
        return this.requestAppliances('PUT', haid, '/settings/' + settingKey, {
            data: {
                key:    settingKey,
                value:  value
            }
        });
    }
    
    // Obtain and maintain an access token
    async authorizeClient() {
        while (true) {
            try {
                
                // Authorize this client if there is no saved authorization
                if (!this.savedAuth[this.clientID]) {
                    let token = await (this.simulator
                                       ? this.authCodeGrantFlow()
                                       : this.authDeviceFlow());
                    this.tokenSave(token);
                }

                // Refresh the access token before it expires
                while (true) {

                    // Check the validity of the current access token
                    let auth = this.savedAuth[this.clientID];
                    let refreshIn = auth.accessExpires - Date.now()
                                    - TOKEN_REFRESH_WINDOW * MS;
                    if (auth.accessToken && 0 < refreshIn) {
                        
                        // Resolve any promises awaiting authorization
                        for (let resolve of this.authResolve) resolve();
                        this.authResolve = [];
                    
                        // Delay before refreshing the access token
                        this.log('Refreshing access token in '
                                 + Math.floor(refreshIn / MS) + ' seconds');
                        await this.sleep(refreshIn, 'refresh');
                    }

                    // Refresh the access token
                    let token = await this.tokenRefresh(auth.refreshToken);
                    this.tokenSave(token);
                }
                
            } catch (err) {
                
                // Discard any access token and report the error
                this.tokenInvalidate();
                this.log(err.message);

                // Delay before retrying authorization
                let retryIn = this.savedAuth[this.clientID]
                              ? REFRESH_RETRY_DELAY : AUTH_RETRY_DELAY;
                this.log('Retrying client authentication in ' + retryIn
                         + ' seconds');
                await this.sleep(retryIn * MS);
            }
        }
    }

    // Wait until an access token has been obtained
    waitUntilAuthorized() {
        // Resolve immediately if already authorized, otherwise add to queue
        let auth = this.savedAuth[this.clientID];
        if (auth && auth.accessToken && Date.now() < auth.accessExpires) {
            return Promise.resolve();
        } else {
            return new Promise(resolve => this.authResolve.push(resolve));
        }
    }

    // Obtain the current access token (or throw an error if not authorized)
    getAuthorization() {
        let token = this.savedAuth[this.clientID].accessToken;
        if (!token) throw new Error('Home Connect client is not authorized');
        return 'Bearer ' + token;
    }

    // A new access token has been obtained
    tokenSave(token) {
        this.log('Refresh token ' + token.refresh_token);
        this.log('Access token  ' + token.access_token
                 + ' (expires after ' + token.expires_in + ' seconds)');

        // Save the refresh and access tokens
        this.savedAuth[this.clientID] = {
            refreshToken:   token.refresh_token,
            accessToken:    token.access_token,
            accessExpires:  Date.now() + token.expires_in * MS
        };
        this.emit('auth_save', this.savedAuth);
    }

    // Device authorization flow (used for the live server)
    async authDeviceFlow() {
        // Obtain verification URI
        this.log('Requesting Home Connect authorization using the Device Flow');
        let resp = await this.requestRaw({
            method:  'POST',
            url:     this.url + '/security/oauth/device_authorization',
            json:    true,
            form:    {
                client_id:  this.clientID,
                scope:      SCOPES.join(' ')
            }
        });
        this.emit('auth_uri', resp.verification_uri_complete);
        this.log('Waiting for completion of Home Connect authorization'
                 + ' (poll every ' + resp.interval + ' seconds,'
                 + ' device code ' + resp.device_code + ' expires'
                 + ' after ' + resp.expires_in + ' seconds)...');

        // Wait for the user to authorize access (or expiry of device code)
        let token;
        while (!token)
        {
            // Wait for the specified poll interval
            await this.sleep(resp.interval * MS);

            // Poll for a device access token (returns null while auth pending)
            token = await this.requestRaw({
                method:  'POST',
                url:     this.url + '/security/oauth/token',
                json:    true,
                form:    {
                    client_id:      this.clientID,
                    grant_type:     'device_code',
                    device_code:    resp.device_code
                }
            });
        }

        // Return the access token
        return token;
    }
    
    // Authorization code grant flow (used for the simulator)
    async authCodeGrantFlow() {
        // Request authorization, skipping the user interaction steps
        this.log('Attempting to short-circuit Authorization Code Grant Flow '
                 + 'for the Home Connect appliance simulator');
        let location = await this.requestRaw({
            method:         'GET',
            url:            this.url + '/security/oauth/authorize',
            followRedirect: false,
            qs:      {
                client_id:      this.clientID,
                response_type:  'code',
                scope:          SCOPES.join(' '),
                user:           'me' // (can be anything non-zero length)
            },
        });

        // Extract the authorization code from the redirection URL
        let code = querystring.parse(url.parse(location).query).code;
        this.log('Using authorization code ' + code + ' to request token');

        // Convert the authorization code into an access token
        let token = await this.requestRaw({
            method:  'POST',
            url:     this.url + '/security/oauth/token',
            json:    true,
            form:    {
                client_id:      this.clientID,
                grant_type:     'authorization_code',
                code:           code
            }
        });

        // Return the access token
        return token;
    }

    // Refresh the access token
    async tokenRefresh(refreshToken) {
        // Request a refresh of the access token
        this.log('Refreshing Home Connect access token');
        let token = await this.requestRaw({
            method:  'POST',
            url:     this.url + '/security/oauth/token',
            json:    true,
            form:    {
                grant_type:     'refresh_token',
                refresh_token:  refreshToken
            }
        });

        // Request returns null if authorization is pending (shouldn't happen)
        if (!token) throw new Error('Authorization pending');

        // Return the refreshed access token
        return token;
    }

    // Invalidate saved authentication data if server indicates it is invalid
    authInvalidate() {
        delete this.savedAuth[this.clientID];
        this.wake('refresh', new Error('Client authentication invalidated'));
    }

    // Invalidate the current access token if server indicates it is invalid
    tokenInvalidate() {
        let auth = this.savedAuth[this.clientID];
        if (auth) delete auth.accessToken;
        this.wake('refresh', new Error('Access token invalidated'));
    }

    // Delay before issuing another request if the server indicates rate limit
    retryAfter(delaySeconds) {
        let earliest = Date.now() + delaySeconds * MS;
        if (this.earliestRetry < earliest) {
            this.earliestRetry = earliest;
        }
    }

    // Issue a normal home appliances API request
    async requestAppliances(method, haid, path, body) {
        // Construct request (excluding authorization header which may change)
        let options = {
            method:  method,
            url:     this.url + '/api/homeappliances',
            json:    true,
            headers: {
                accept:         'application/vnd.bsh.sdk.v1+json',
                'content-type': 'application/vnd.bsh.sdk.v1+json'
            }
        };
        if (haid) options.url += '/' + haid + (path || '');
        if (body) options.body = body;

        // Implement retries
        while (true) {

            // Apply rate limiting
            let retryIn = this.earliestRetry - Date.now();
            if (0 < retryIn) {
                this.log('Waiting ' + Math.floor(retryIn / MS)
                         + ' seconds before issuing Home Connect API request');
                await this.sleep(retryIn);
            }
        
            // Try issuing the request
            try {
                
                options.headers['authorization'] = this.getAuthorization();
                let body = await this.requestRaw(options);
                return body && body.data;
                
            } catch (err) {

                // Re-throw the error if the request cannot be retried
                if (!err.retry) throw err;

            }
        }
    }

    // Issue a raw Home Connect request
    async requestRaw(options) {
        
        // Log the request
        let logPrefix = 'Home Connect request #' + ++this.requestCount + ': ';
        this.log(logPrefix + options.url);
        let startTime = Date.now();

        // Issue the request
        let status = 'OK';
        try {

            return await requestPromise(options);
            
        } catch (err) {

            // Status codes returned by the server have special handling
            status = err.message;
            if (err.name == 'StatusCodeError') {

                // Redirection is not an error when expected
                if (!options.followRedirect && err.statusCode == 302) {
                    let uri = err.response.headers['location'];
                    status = 'Redirect ' + uri;
                    return uri;
                }

                // Inspect any response returned by the server
                let body = options.json ? err.response.body
                                        : this.parseJSON(err.response.body);
                if (body && body.error_description) {

                    // Authorization (OAuth) error response
                    status = body.error_description + ' [' + body.error + ']';

                    // Special handling for some authorization errors
                    switch (body.error) {
                    case 'authorization_pending':
                        // User has not yet completed the user interaction steps
                        status = 'Authorization pending';
                        return null;
                        break;
                        
                    case 'access_denied':
                        if (body.error_description == 'Too many requests') {
                            // Token refresh rate limit exceeded
                            status = 'Token refresh rate limit exceeded'
                                  + ' (only 100 refreshes are allowed per day)';
                            err.retry = true;
                            break;
                        }
                        // fallthrough
                    case 'invalid_grant':
                    case 'expired_token':
                        // Refresh token not valid; restart whole authorization
                        this.authInvalidate();
                        break;
                        
                    case 'unauthorized_client':
                        // There is a problem with the client
                        this.authInvalidate();
                        status = CLIENT_HELP_PREFIX1 + body.error_description;
                        let extra = CLIENT_HELP_EXTRA[body.error_description];
                        if (extra) status += CLIENT_HELP_PREFIX2 + extra;
                        break;
                    }
                    
                } else if (body && body.error && body.error.key) {

                    // Normal Home Connect API error format
                    status = (body.error.developerMessage
                              || body.error.description
                              || body.error.value)
                             + ' [' + body.error.key + ']';

                    // Special handling for some API errors
                    switch (body.error.key) {
                    case 'invalid_token':
                        // Problem with the access token
                        this.tokenInvalidate();
                        break;
                        
                    case '429':
                        // Rate limit exceeded (wait Retry-After header seconds)
                        let delay = err.response.headers['retry-after'];
                        this.retryAfter(delay);
                        err.retry = true;
                        break;
                    }
                }
                    
                // Use the server's response for the error message
                err.message = 'Home Connect API error: ' + status;
            }

            // Re-throw the error unless suppressed above
            throw err;
            
        } finally {

            // Log completion of the request
            this.log(logPrefix + status
                     + ' +' + (Date.now() - startTime) + 'ms ');
            
        }
    }

    // Get events stream for one appliance
    async getEvents(haid) {
        // Construct request (excluding authorization header which may change)
        let options = {
            method:     'GET',
            url:        this.url + '/api/homeappliances/' + haid + '/events',
            encoding:   'utf8',
            json:       true,
            headers: {
                accept: 'text/event-stream'
            }
        };

        // Implement retries
        while (true) {

            // Apply rate limiting
            let retryIn = this.earliestRetry - Date.now();
            if (0 < retryIn) {
                this.log('Waiting ' + Math.floor(retryIn / MS) + ' seconds'
                         + ' before issuing Home Connect events request');
                await this.sleep(retryIn);
            }
            
            // Try issuing the request
            try {
                
                options.headers['authorization'] = this.getAuthorization();
                this.log('Starting events stream for ' + haid);
                let event = {};
                return await this.requestStream(options, haid, line => {
                    
                    // Process a line from the stream
                    if (line.length == 0) {
                        // End of event, so issue a notification
                        if (Object.keys(event).length) this.emit(haid, event);
                        event = {};
                    } else {
                        // More information about the event
                        let data = /^(\w+):\s*(.*)$/.exec(line);
                        if (!data) {
                            // Simulator outputs ":ok" at start of event stream
                            this.log("Unable to parse event '" + line + "'");
                            return;
                        }
                        let key = data[1], value = data[2];
                        if (key == 'data' && value.length) {
                            value = JSON.parse(value);
                        }
                        event[key] = value;
                    }
                });
                
            } catch  (err) {

                // Re-throw the error if the request cannot be retried
                if (!err.retry) throw err;

            }
        }
    }

    // Stop events stream for one appliance
    stopEvents(haid) {
        this.log('Stopping events stream for ' + haid);
        let abort = this.streamAbort[haid];
        if (abort) {
            abort();
            delete this.streamAbort[haid];
        }
    }

    // A Promise wrapper around an events stream
    requestStream(options, token, callback) {
        return new Promise((resolve, reject) => {
            // Start the request
            let aborted = false;
            let req = this.requestStreamRaw(options, line => {
                // Pass on any received stream data, unless aborted
                if (!aborted) callback(line);                
            }, err => {
                // The event stream has finished, possibly with an error
                if (err) reject(err);
                else     resolve();
            });

            // Provide a mechanism to abort the request
            this.streamAbort[token] = () => {
                aborted = true;
                req.abort(); // (doesn't emit 'complete' event)
                resolve();
            }
        });
    }
        
    // Issue a raw Home Connect request in streaming mode
    requestStreamRaw(options, callbackLine, callbackDone) {
        
        // Log the request
        let logPrefix = 'Home Connect request #' + ++this.requestCount + ': ';
        this.log(logPrefix + options.url + ' (stream)');
        let startTime = Date.now();

        // Issue and return the request
        return request(options).on('error', err => {

            // Log and return any error
            this.log(logPrefix + err.message
                     + ' +' + (Date.now() - startTime) + 'ms ');
            callbackDone(err);
            
        }).on('response', response => {            
            if (response.statusCode == 200) {
                
                // Successfully established stream so handle any received data
                response.on('data', chunk => {
                    this.log(logPrefix + '(stream data received)'
                             + ' +' + (Date.now() - startTime) + 'ms ');
                    chunk.split(/\r?\n/).forEach(line => callbackLine(line));
                }).on('end', () => {
                    this.log(logPrefix + '(stream end)'
                             + ' +' + (Date.now() - startTime) + 'ms ');
                });
                
            }
        }).on('complete', (response, body) => {

            // Attempt to extract a useful error message
            let status = response.statusMessage;
            if (body && body.error && body.error.key) {

                // Normal Home Connect API error format
                status = (body.error.developerMessage
                          || body.error.description
                          || body.error.value)
                         + ' [' + body.error.key + ']';
                
                // Special handling for some API errors
                switch (body.error.key) {
                case 'invalid_token':
                    // Problem with the access token
                    this.tokenInvalidate();
                    break;
                    
                case '429':
                    // Rate limit exceeded (wait Retry-After header seconds)
                    let delay = err.response.headers['retry-after'];
                    this.retryAfter(delay);
                    err.retry = true;
                    break;
                }
            }

            // Log completion of the request
            this.log(logPrefix + status
                     + ' +' + (Date.now() - startTime) + 'ms ');
            
            // Indicate that the request is complete, returning any error
            callbackDone(response.statusCode == 200 ? null
                         : new Error('Home Connect API error: ' + status));
            
        });
    }

    // Attempt to parse JSON, returning null instead of an error for failure
    parseJSON(text) {
        try {
            return JSON.parse(text);
        } catch (err) {
            return null;
        }
    }

    // Sleep for a specified number of milliseconds
    sleep(milliseconds, id) {
        return new Promise((resolve, reject) => {
            if (id) this.sleepReject[id] = reject;
            setTimeout(resolve, milliseconds);
        });
    }

    // Cancel a previous sleep with an error
    wake(id, err) {
        let reject = this.sleepReject[id];
        if (reject) reject(err || new Error('Sleep aborted'));
    }
}