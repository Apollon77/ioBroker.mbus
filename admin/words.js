systemDictionary = {
    "page_title":   {"en": "NUT Adapter Settings",       "de": "NUT Adapter Einstellungen",    "ru": "NUT Adapter Settings"},
    "host_ip":   {"en": "NUT Server IP",       "de": "IP des NUT Servers",    "ru": "IP NUT сервера"},
    "host_port": {"en": "NUT Server port",     "de": "Port des NUT Servers",  "ru": "Порт NUT сервера"},
    "ups_name":  {"en": "NUT Name of the UPS", "de": "NUT Name der UPS",     "ru": "NUT имя UPS"},
    "username":  {"en": "Username of the UPS", "de": "Username der UPS",     "ru": "Username of the UPS"},
    "password":  {"en": "Password of the UPS", "de": "Passwort der UPS",     "ru": "Password of the UPS"},
    "update_interval":  {"en": "Update Interval", "de": "Aktualisierungsintervall",     "ru": "Update Interval"},
    "ip_info": {
      "en":"IP address of the NUT server. NUT needs to run in server mode and needs to be accessible by the computer the iobroker NUT adapter runs on. So check firewall settings if you have problems and allow the access. If the UPS is connected locally you can also use 127.0.0.1 or localhost.",
      "de":"IP Adresse des NUT Servers. NUT muss im Server-Mode konfiguriert sein und von dem Rechner auf dem der iobroker Adapter installiert ist erreichbar sein. Bei Problemen sollten die Firewall-Einstellungen geprüft werden, dass der Zugriff gestattet ist. Wenn die USV am lokalen rechner angeschlossen ist kann 127.0.0.1 oder localhost genutzt werden.",
      "ru":"IP address of the NUT server. NUT needs to run in server mode and needs to be accessible by the computer the iobroker NUT adapter runs on. So check firewall settings if you have problems and allow the access. If the UPS is connected locally you can also use 127.0.0.1 or localhost."
    },
    "port_info": {
      "en":"Port of NUT. The default port is 3493.",
      "de":"Port des NUT Servers. Der Standardport ist 3493.",
      "ru":"Port of NUT. The default port is 3493."
    },
    "name_info": {
      "en":"Name of the UPS as defined in the NUT configuration of the NUT server.</p>Hint: If you want to connect to an UPS connected to a Synology diskstation the name is simply 'ups'.",
      "de":"Name der USV, wie in den NUT EInstellungen definiert.</p>Hinweis: Für eine USV, die an eine Synology Diskstation angeschlossen ist, lautet der Name 'ups'.",
      "ru":"Name of the UPS as defined in the NUT configuration of the NUT server.</p>Hint: If you want to connect to an UPS connected to a Synology diskstation the name is simply 'ups'."
    },
    "update_interval_info": {
      "en":"Interval in Seconds to update the data.",
      "de":"Intervall in Sekunden in dem die Daten aktualisiert werden.",
      "ru":"Interval in Seconds to update the data."
    },
    "trouble_info": {
      "en":"When you turn the adapter into debug then you can see all created states and their data in the logfile. If you have problems and the adapter do not deliver the data you can use the two scripts in directory 'test' of the adapter installation (so normally in node_modules/iobroker.nut/test relative to your iobroker installation directory) to try it out on the commandline. Call the scripts using 'node filename.js' to see the awaited parameters.</p><ul><li><b>test_upslist.js</b>: Connects to the NUT server and returns a list of available UPS names</li><li><b>test_upsvars.js</b>: Connects to the NUT server for a defined UPS and returns a list of available UPS variables</li></ul>",
      "de":"Wenn der Adapter im Debug Modus gestartet wird, werden im Logfile alle erzeugten States und deren Daten aufgelistet. Wenn der Adapter keine Daten liefert können für direklte Tests auch die beiden Skripte im Verzeichnis 'test' der Adapter-Installation (normalerweise unter node_modules/iobroker.nut/test relativ zur iobroker-Installation) an der Kommandozeile aufgerufen werden. Die Skripte können mit 'node filename.js' aufgerufen werden um die benötigten Parameter zu sehen.<ul><li><b>test_upslist.js</b>: Verbindet sich zu einem NUT Server und gibt die Namen der verbundenen USVs aus</li><li><b>test_upsvars.js</b>: Verbindet sich zu einem NUT Server für eine definierte USV und gibt die verfügbaren UPS Varialen aus</li></ul>",
      "ru":"When you turn the adapter into debug then you can see all created states and their data in the logfile. If you have problems and the adapter do not deliver the data you can use the two scripts in directory 'test' of the adapter installation (so normally in node_modules/iobroker.nut/test relative to your iobroker installation directory) to try it out on the commandline. Call the scripts using 'node filename.js' to see the awaited parameters.</p><ul><li><b>test_upslist.js</b>: Connects to the NUT server and returns a list of available UPS names</li><li><b>test_upsvars.js</b>: Connects to the NUT server for a defined UPS and returns a list of available UPS variables</li></ul>"
    }
};
