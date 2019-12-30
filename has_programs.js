// Homebridge plugin for Home Connect home appliances
// Copyright © 2019 Alexander Thoukydides

'use strict';

let Service, Characteristic;

// Add program support to an accessory
module.exports = {
    init() {
        // Shortcuts to useful HAP objects
        Service = this.homebridge.hap.Service;
        Characteristic = this.homebridge.hap.Characteristic;

        // Enable polling of selected/active programs when connected
        this.device.pollPrograms();

        // Use the identify request to log details of all available programs
        // (the callback is called by the base class, so no need to do so here)
        this.accessory.on('identify', () => this.logPrograms());

        // Add services to monitor or control programs
        let config = this.config.programs;
        if (config && Array.isArray(config)) {
            // Add the programs specified in the configuration file
            this.addConfiguredPrograms(config);
        } else {
            // Add a service for each program supported by the appliance
            this.addAllPrograms();
        }
    },

    // Read and log details of all available programs
    async logPrograms() {
        try {
            // Read details of the available programs
            let allPrograms = await this.device.getAllPrograms();
            let programs = await this.device.getAvailablePrograms();

            // Convert an option into a form that can be used in config.json
            function optionValue(option) {
                // If the option has an actual or default value then use that
                let value = null;
                if ('value' in option) {
                    value = option.value;
                } else if ('default' in option) {
                    value = option.default;
                }

                // Use any additional information to generate a helpful comment
                let comment;
                if (option.constraints) {
                    if (option.constraints.allowedvalues) {
                        let {allowedvalues} = option.constraints;
                        if (value === null) value = allowedvalues[0];
                        if (1 < allowedvalues.length) comment = allowedvalues;
                    } else if ('min' in option.constraints
                               && 'max' in option.constraints) {
                        let {type, unit} = option;
                        let {min, max, stepsize} = option.constraints;
                        if (value === null) value = min;
                        let commentParts = [];
                        if (type) commentParts.push(type);
                        commentParts.push('[' + min, '..', max + ']');
                        if (stepsize) commentParts.push('step ' + stepsize);
                        if (unit) commentParts.push(unit);
                        comment = commentParts.join(' ');
                    }
                }

                // Return the value and comment
                return [value, comment];
            }

            // Log details of each program
            let json = {
                [this.device.haId]: {
                    programs:       programs.map(program => ({
                        name:       this.simplifyProgramName(program.name),
                        key:        program.key,
                        options:    program.options.reduce((result, option) => {
                            let [value, comment] = optionValue(option);
                            result[option.key] = value;
                            if (comment) result['_' + option.key] = comment;
                            return result;
                        }, {})
                    }))
                }
            };
            this.log(programs.length + ' of ' + allPrograms.length
                     + ' programs available\n' + JSON.stringify(json, null, 4));
            let missing = allPrograms.length - programs.length;
            if (0 < missing)
                this.warn(missing + ' programs not currently available');
        } catch (err) {
            this.warn(err.message);
        }
    },

    // Add a service for each program supported by the appliance
    async addAllPrograms() {
        // Obtain a list of all programs
        let allPrograms = await this.getCached('programs',
                                            () => this.device.getAllPrograms());
        if (!allPrograms || !allPrograms.length) {
            this.warn('Does not support any programs');
            allPrograms = [];
        }

        // Convert to the configuration format
        let config = allPrograms.map(program => ({
            name:   this.simplifyProgramName(program.name),
            key:    program.key
        }));

        // Add a service for each supported program
        this.addPrograms(config);
    },

    // Add the programs specified in the configuration file
    async addConfiguredPrograms(config) {
        // Obtain a list of all programs
        let allPrograms = await this.getCached('programs',
                                            () => this.device.getAllPrograms());

        // Perform some validation of the configuration
        let names = [];
        config = config.filter(program => {
            try {
                // Check that a name and program key have both been provided
                if (!('name' in program))
                    throw new Error("No 'name' field provided for program");
                if (!('key' in program))
                    throw new Error("No 'key' field provided for program");

                // Check that the name is unique
                if (names.includes(program.name))
                    throw new Error("Program name '" + program.name
                                    + "' is not unique");
                names.push(program.name);

                // Check that the program key is supported by the appliance
                if (!allPrograms.some(all => all.key == program.key))
                    throw new Error("Program key '" + program.key
                                    + "' is not supported by the appliance");

                // Clean options, ignoring keys starting with underscore
                let cleanOptions = {};
                for (let key of Object.keys(program.options || {})) {
                    if (!key.startsWith('_')) {
                        let value = program.options[key];
                        cleanOptions[key] = value;
                    }
                }

                // It appears to be a valid configuration
                program.options = cleanOptions;
                return true;
            } catch (err) {
                this.error('Invalid program configuration ignored: '
                           + err.message + '\n'
                           + JSON.stringify(program, null, 4));
                return false;
            }
        });

        // Add a service for each configured program
        this.addPrograms(config);
    },

    // Add a list of programs
    addPrograms(programs) {
        // Cache of previously added program services
        let saved = this.accessory.context.programServices;
        if (!saved) saved = this.accessory.context.programServices = {};
        for (let subtype of Object.keys(saved)) saved[subtype] = null;

        // Add a service for each program
        this.log('Adding services for ' + programs.length + ' programs');
        let services = [];
        for (let program of programs) {
            // Log information about this program
            this.log("    '" + program.name + "' (" + program.key + ')');
            let options = program.options || {};
            for (let key of Object.keys(options))
                this.log('        ' + key + '=' + options[key]);

            // Add the service for this program
            let service = this.addProgram(program);
            services.push(service);
            saved[service.subtype] = program.name;
        }

        // Delete any services that are no longer required
        let obsolete = Object.keys(saved).filter(subtype => !saved[subtype]);
        this.log('Removing services for ' + obsolete.length + ' programs');
        for (let subtype of obsolete) {
            let service = this.accessory.getServiceByUUIDAndSubType(
                Service.Switch, subtype);
            if (service) this.accessory.removeService(service);
        }

        // Make the services read-only when programs cannot be controlled
        let allowWrite = write => {
            let perms = [Characteristic.Perms.READ,
                         Characteristic.Perms.NOTIFY];
            if (write) perms.push(Characteristic.Perms.WRITE);
            for (let service of services) {
                service.getCharacteristic(Characteristic.On)
                    .setProps(perms);
            }
        };
        if (this.device.hasScope('Control')) {
            // Update based on whether remote control start is allowed
            this.device.on('BSH.Common.Status.RemoteControlStartAllowed',
                           item => {
                this.log('Remote control start '
                         + (this.value ? 'has been activated' : 'disabled'));
                allowWrite(this.value);
            });
        } else if (programs.length) {
            // Control of this appliance has not been authorized
            this.warn('Programs cannot be controlled without Control scope');
            allowWrite(false);
        }
    },

    // Add a single program
    addProgram({name, key, options}) {
        // Add a switch service for this program
        let subtype = 'program ' + name;
        let service =
            this.accessory.getServiceByUUIDAndSubType(Service.Switch, subtype)
            || this.accessory.addService(Service.Switch,
                                         this.name + ' ' + name, subtype);

        // Start or stop the active program
        service.getCharacteristic(Characteristic.On)
            .on('set', this.callbackify(async value => {
                if (value) {
                    this.log("START Program '" + name + "' (" + key + ')');
                    await this.device.startProgram(key, options);
                } else {
                    this.log("STOP Program '" + name + "' (" + key + ')');
                    await this.device.stopProgram();
                }
            }));

        // Update the status
        this.device.on('BSH.Common.Root.ActiveProgram', item => {
            let active = item.value == key;
            this.log("Program '" + name + "' (" + key + ') '
                     + (active ? 'active' : 'inactive'));
            service.updateCharacteristic(Characteristic.On, active);
        });
        this.device.on('BSH.Common.Status.OperationState', item => {
            const inactiveStates = [
                'BSH.Common.EnumType.OperationState.Inactive',
                'BSH.Common.EnumType.OperationState.Ready',
                'BSH.Common.EnumType.OperationState.Finished'
            ];
            if (inactiveStates.includes(item.value)) {
                this.log("Program '" + name + "' (" + key + ') inactive');
                service.updateCharacteristic(Characteristic.On, false);
            }
        });

        // Return the service
        return service;
    },

    // HomeKit restricts the characters allowed in names
    simplifyProgramName(name) {
        return name.replace(/[^-a-z0-9.' ]/ig, '')
                   .replace(/^\W/, '')
                   .replace(/\W$/, '');
    }
}