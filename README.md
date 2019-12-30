# homebridge-homeconnect

[![NPM](https://nodei.co/npm/homebridge-homeconnect.png)](https://nodei.co/npm/homebridge-homeconnect/)

Home Connect home appliances plugin for [Homebridge](https://github.com/nfarina/homebridge).

[Home Connect](https://www.home-connect.com), [Bosch](https://www.bosch-home.com/), [Siemens](https://www.siemens-home.bsh-group.com/), [Gaggenau](https://www.gaggenau.com/), [NEFF](https://www.neff-home.com/), and [Thermador](https://www.thermador.com/) are trademarks of [BSH Home Appliances](https://www.bsh-group.com).

## Installation

1. Connect your home appliances with Home Connect:
   1. Install Home Connect from the Apple App Store for your country (e.g. [UK](https://itunes.apple.com/gb/app/home-connect-app/id901397789) or [USA](https://itunes.apple.com/us/app/home-connect-america/id1134525430)).
   1. Create an account using your email address, click on the validation link in the email that will be received, and then return to the app and login.
   1. Connect the appliances to your home network, either via the app or using Wi-Fi Protected Setup (WPS).
   1. Connect the appliances to the app (by following the installation guide provided with the appliance).
1. Obtain a Home Connect application *Client ID*:
   1. Sign-up for a free [Home Connect Developer Program](https://developer.home-connect.com/user/register) account and login.
   1. [Register a new application](https://developer.home-connect.com/applications/add), ensuring that the *OAuth Flow* is set to *Device Flow*, and the *Home Connect User Account* is the same as the email address that was used within the Home Connect app.
   1. Save the displayed *Client ID* to include in the Homebridge `config.json` file.
1. Install this plugin using: `npm install -g homebridge-homeconnect`
1. Edit `config.json` and add the HomeConnect platform (see example below).
1. Run [Homebridge](https://github.com/nfarina/homebridge).
1. The Homebridge log output will include an authorization URL. Copy the listed URL into a web browser and login to your Home Connect account.
 
### Example `config.json`
```JSON
{
    "platforms":
    [{
        "platform":     "HomeConnect",
        "clientid":     "0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF"
    }]
}
```
The `clientid` should be set to the *Client ID* obtained from the [Home Connect Developer Program](https://developer.home-connect.com/applications) for the created *Device Flow* application.

To use [simulated appliances](https://developer.home-connect.com/simulator/) set `clientid` to the  *Client ID* for the automatically provided API Web Client and set `"simulator": true`.

## Notes

This plugin was developed and tested with a Siemens oven (HB678GBS6B/58), induction hob (EX677LYV1E/06), and dishwasher (SN678D06TG/53). Some additional testing was performed using the [Home Connect appliance simulators](https://developer.home-connect.com/simulator). It should work with all other Home Connect appliances, but functionality is currently more limited (and bugs are more likely) for other appliance types.

### Capabilities

The following general functionality is supported by this plugin for different appliance types:

|                            | CoffeeMaker | Dishwasher | Dryer/ Washer/ WasherDryer | FridgeFreezer / Freezer / Refrigerator / WineCooler | Hob    | Hood       | Oven       | CleaningRobot / CookProcessor |
| -------------------------- | :---------: | :--------: | :------------------------: | :-------------------------------------------------: | :----: | :--------: | :--------: | :---------------------------: |
| **Power on/off**           | Read/Write  | Read/Write | Read                       | Read                                                | Read   | Read/Write | Read/Write | Read                          |
| **Door open/closed**       | Read        | Read       | Read                       | Read                                                | -      | -          | Read       | -                             |
| **Program finished event** | -           | Notify     | Notify                     | -                                                   | Notify | Notify     | Notify     | -                             |
| **Program aborted event**  | -           | Notify     | Notify                     | -                                                   | -      |            | -          | -                             |
| **Program time remaining** | Read        | Read       | Read                       | -                                                   | -      | Read       | Read       | -                             |
| **Operation state active** | Read        | Read       | Read                       | -                                                   | Read   | Read       | Read       | -                             |
| **Operation state error**  | Read        | -          | Read                       | -                                                   | Read   | -          | Read       | -                             |

#### Cooking appliances

Some additional functionality is supported for cooking appliances:

|                                | CoffeeMaker | CookProcessor | Hob    | Hood                         | Oven   |
| ------------------------------ | :---------: | :-----------: | :----: | :--------------------------: | :----: |
| **Fan speed/auto control**     | -           | -             |        | Read/Write :crossed_fingers: | -      |
| **Functional light control**   | -           | -             |        | Read/Write :crossed_fingers: | -      |
| **Ambient light control**      | -           | -             |        | Read/Write :crossed_fingers: | -      |
| **Timer finished event**       | -           | -             | Notify |                              | Notify |
| **Preheat finished event**     | -           | -             | Notify |                              | Notify |
| **Bean container empty event** | Notify      | -             | -      | -                            | -      |
| **Water tank empty event**     | Notify      | -             | -      | -                            | -      |
| **Drip tray full event**       | Notify      | -             | -      | -                            | -      |

:crossed_fingers: *Control of the fan and light in Hood appliances has been implemented but not tested. Please add any feedback to [issue #2](https://github.com/thoukydides/homebridge-homeconnect/issues/2).*

#### Cleaning appliances

Some additional functionality is supported for cleaning appliances:

|                    | CleaningRobot | Dishwasher | Dryer | Washer | WasherDryer |
| ------------------ | :-----------: | :--------: | :---: | :----: | :---------: |
| *(None currently)* | -             | -          | -     | -      | -           |

#### Cooling appliances

Some additional functionality is supported for cooling appliances:

|                                     | Freezer | FridgeFreezer | Refrigerator | WineCooler |
| ----------------------------------- | :-----: | :-----------: | :----------: | :--------: |
| **Freezer door alarm event**        | Notify  | Notify        | -            | -          |
| **Refrigerator door alarm event**   | -       | Notify        | Notify       | -          |
| **Freezer temperature alarm event** | Notify  | Notify        | -            | -          |

### HomeKit Services and Characteristics

*HomeKit* does not define services and characteristics for home appliances, so the following are used: 

| Service                        | Characteristic              | Used for                                      |
| ------------------------------ | --------------------------- | --------------------------------------------- |
| `Switch`                       | `On`                        | Power on/off                                  |
| `Stateless Programmable Switch`| `Programmable Switch Event` | Events                                        |
| `Fan` *(v2)*                   | `Active`                    | Hood fan on/off control                       |
| `Fan` *(v2)*                   | `Current Fan State`         | Hood fan on/off indication                    |
| `Fan` *(v2)*                   | `Target Fan State`          | Hood fan manual/automatic                     |
| `Fan` *(v2)*                   | `Rotation Speed`            | Hood fan speed                                |
| `Lightbulb`                    | `On`                        | Hood light on/off (ambient or functional)     |
| `Lightbulb`                    | `Brightness`                | Hood light brightness (ambient or functional) |
| `Lightbulb`                    | `Hue`                       | Hood light colour (ambient)                   |
| `Lightbulb`                    | `Saturation`                | Hood light colour (ambient)                   |
| `Home Appliance` *(custom)*    | `Current Door State`        | Door open/closed                              |
| `Home Appliance` *(custom)*    | `Remaining Duration`        | Program progress                              |
| `Home Appliance` *(custom)*    | `Active`                    | Operation state active                        |
| `Home Appliance` *(custom)*    | `Status Active`             | Operation state active                        |
| `Home Appliance` *(custom)*    | `Status Fault`              | Operation state error                         |

For events, a `Single Press` is generated when the event occurs and is present, and a `Double Press` after it has been confirmed by the user.

Unfortunately, Apple's Home app (as of iOS 13) does not support custom services, and only shows numeric labels for `Stateless Programmable Switch` services. For full functionality use one of the following apps:
* Elgato's [Eve](https://www.elgato.com/en/eve/eve-app) *(free and recommended)*.
* Matthias Hochgatterer's [Home+](http://hochgatterer.me/home/)

### No Control of Ovens, Hobs, or Fridge-Freezers

The [Home Connect Developer Agreement](https://developer.home-connect.com/developer_agreement) says (in section 7):
> Certain additional permissions to those specified at: https://developer.home-connect.com/docs/authorization/scope may be granted to Clients of selected Users upon an individual check by HC and upon agreement of a separate partner agreement between the Parties, which is based on this Agreement.

This is required for the `Hob-Control`, `Oven-Control`, and `FridgeFreezer-Images` scopes. Additionally, the appliance simulator disallows `CookProcessor-Control` and `FridgeFreezer-Control`. These scopes are therefore not supported by this plugin. Control of these appliances is limited to just power on/off (where supported by the Home Connect API), read-only status, and notification events.

Use IFTTT Webhooks (e.g. via [homebridge-ifttt](https://www.npmjs.com/package/homebridge-ifttt)) to control these appliances.

## License

> ISC License (ISC)<br>Copyright © 2019 Alexander Thoukydides
>
> Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.
>
> THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
