// Homebridge plugin for Home Connect home appliances
// Copyright © 2019 Alexander Thoukydides

'use strict';

// Add an appliance door to an accessory
module.exports = {
    init() {
        // Shortcuts to useful HAP objects
        const Characteristic = this.homebridge.hap.Characteristic;
        const { OPEN, CLOSED } = Characteristic.CurrentDoorState;
        
        // Add the door state characteristic
        this.haService.getCharacteristic(Characteristic.CurrentDoorState)
            .setProps({ validValues: [OPEN, CLOSED] });

        // Update the door status
        this.device.on('BSH.Common.Status.DoorState', item => {
            let isClosed = item.value == 'BSH.Common.EnumType.DoorState.Closed';
            this.log('Door ' + (isClosed ? 'closed' : 'open'));
            this.haService.updateCharacteristic(Characteristic.CurrentDoorState,
                                                isClosed ? CLOSED : OPEN);
        });
    }
}
