const Applet = imports.ui.applet;
const Mainloop = imports.mainloop;
const CMenu = imports.gi.CMenu;
const Lang = imports.lang;
const Cinnamon = imports.gi.Cinnamon;
const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const Main = imports.ui.main;
const MessageTray = imports.ui.messageTray;
const PopupMenu = imports.ui.popupMenu;
const AppFavorites = imports.ui.appFavorites;
const Gtk = imports.gi.Gtk;
const Atk = imports.gi.Atk;
const Gio = imports.gi.Gio;
const GnomeSession = imports.misc.gnomeSession;
const ScreenSaver = imports.misc.screenSaver;
const FileUtils = imports.misc.fileUtils;
const Util = imports.misc.util;
const DND = imports.ui.dnd;
const Meta = imports.gi.Meta;
const DocInfo = imports.misc.docInfo;
const GLib = imports.gi.GLib;
const Settings = imports.ui.settings;
const Pango = imports.gi.Pango;
const AccountsService = imports.gi.AccountsService;
const SearchProviderManager = imports.ui.searchProviderManager;

const MAX_FAV_ICON_SIZE = 32;
const CATEGORY_ICON_SIZE = 22;
const APPLICATION_ICON_SIZE = 22;

const INITIAL_BUTTON_LOAD = 30;
const MAX_BUTTON_WIDTH = "max-width: 20em;";

const USER_DESKTOP_PATH = FileUtils.getUserDesktopDir();

const PRIVACY_SCHEMA = "org.cinnamon.desktop.privacy";
const REMEMBER_RECENT_KEY = "remember-recent-files";

let appsys = Cinnamon.AppSystem.get_default();

/* VisibleChildIterator takes a container (boxlayout, etc.)
 * and creates an array of its visible children and their index
 * positions.  We can then work through that list without
 * mucking about with positions and math, just give a
 * child, and it'll give you the next or previous, or first or
 * last child in the list.
 *
 * We could have this object regenerate off a signal
 * every time the visibles have changed in our applicationBox,
 * but we really only need it when we start keyboard
 * navigating, so increase speed, we reload only when we
 * want to use it.
 */

class VisibleChildIterator {
    constructor(container) {
        this.container = container;
        this.reloadVisible();
    }

    reloadVisible() {
        this.array = this.container.get_focus_chain()
        .filter(x => !(x._delegate instanceof PopupMenu.PopupSeparatorMenuItem));
    }

    getNextVisible(curChild) {
        return this.getVisibleItem(this.array.indexOf(curChild) + 1);
    }

    getPrevVisible(curChild) {
        return this.getVisibleItem(this.array.indexOf(curChild) - 1);
    }

    getFirstVisible() {
        return this.array[0];
    }

    getLastVisible() {
        return this.array[this.array.length - 1];
    }

    getVisibleIndex(curChild) {
        return this.array.indexOf(curChild);
    }

    getVisibleItem(index) {
        let len = this.array.length;
        index = ((index % len) + len) % len;
        return this.array[index];
    }

    getNumVisibleChildren() {
        return this.array.length;
    }

    getAbsoluteIndexOfChild(child) {
        return this.container.get_children().indexOf(child);
    }
}

class ApplicationContextMenuItem extends PopupMenu.PopupBaseMenuItem {
    constructor(appButton, label, action, iconName) {
        super({focusOnHover: false});

        this._appButton = appButton;
        this._action = action;
        this.label = new St.Label({ text: label });

        if (iconName != null) {
            this.icon = new St.Icon({ icon_name: iconName, icon_size: 12, icon_type: St.IconType.SYMBOLIC });
            if (this.icon)
                this.addActor(this.icon);
        }

        this.addActor(this.label);
    }

    activate (event) {
        switch (this._action){
            case "add_to_panel": {
                if (!Main.AppletManager.get_role_provider_exists(Main.AppletManager.Roles.PANEL_LAUNCHER)) {
                    let new_applet_id = global.settings.get_int("next-applet-id");
                    global.settings.set_int("next-applet-id", (new_applet_id + 1));
                    let enabled_applets = global.settings.get_strv("enabled-applets");
                    enabled_applets.push("panel1:right:0:panel-launchers@cinnamon.org:" + new_applet_id);
                    global.settings.set_strv("enabled-applets", enabled_applets);
                }

                let launcherApplet = Main.AppletManager.get_role_provider(Main.AppletManager.Roles.PANEL_LAUNCHER);
                launcherApplet.acceptNewLauncher(this._appButton.app.get_id());

                this._appButton.toggleMenu();
                break;
            } case "add_to_desktop": {
                let file = Gio.file_new_for_path(this._appButton.app.get_app_info().get_filename());
                let destFile = Gio.file_new_for_path(USER_DESKTOP_PATH+"/"+this._appButton.app.get_id());
                try{
                    file.copy(destFile, 0, null, function(){});
                    FileUtils.changeModeGFile(destFile, 755);
                }catch(e){
                    global.log(e);
                }
                this._appButton.toggleMenu();
                break;
            } case "add_to_favorites": {
                AppFavorites.getAppFavorites().addFavorite(this._appButton.app.get_id());
                this._appButton.toggleMenu();
                break;
            } case "remove_from_favorites": {
                AppFavorites.getAppFavorites().removeFavorite(this._appButton.app.get_id());
                this._appButton.toggleMenu();
                break;
            } case "uninstall": {
                Util.spawnCommandLine("/usr/bin/cinnamon-remove-application '" + this._appButton.app.get_app_info().get_filename() + "'");
                this._appButton.appsMenuButton.menu.close();
                break;
            } case "run_with_nvidia_gpu": {
                Util.spawnCommandLine("optirun gtk-launch " + this._appButton.app.get_id());
                this._appButton.appsMenuButton.menu.close();
                break;
            }
        }
        return false;
    }

}

class GenericApplicationButton extends PopupMenu.PopupBaseMenuItem {
    constructor(appsMenuButton, app, withMenu) {
        super({hover: false});
        this.app = app;
        this.appsMenuButton = appsMenuButton;

        this.withMenu = withMenu;
        if (this.withMenu){
            this.menu = new PopupMenu.PopupSubMenu(this.actor);
            this.menu.actor.set_style_class_name('menu-context-menu');
            this.menu.connect('open-state-changed', Lang.bind(this, this._subMenuOpenStateChanged));
        }
    }

    highlight() {
        if (this.actor.has_style_pseudo_class('highlighted'))
            return;

        this.actor.add_style_pseudo_class('highlighted');
    }

    unhighlight() {
        if (!this.actor.has_style_pseudo_class('highlighted'))
            return;

        let appKey = this.app.get_id() || `${this.app.get_name()}:${this.app.get_description()}`;
        this.appsMenuButton._knownApps.add(appKey);
        this.actor.remove_style_pseudo_class('highlighted');
    }

    _onButtonReleaseEvent(actor, event) {
        if (event.get_button()==1){
            this.activate(event);
        }
        if (event.get_button()==3){
            this.activateContextMenus(event);
        }
        return true;
    }

    activate(event) {
        this.unhighlight();
        this.app.open_new_window(-1);
        this.appsMenuButton.menu.close();
    }

    activateContextMenus(event) {
        if (this.withMenu && !this.menu.isOpen)
            this.appsMenuButton.closeContextMenus(this.app, true);
        this.toggleMenu();
    }

    closeMenu() {
        if (this.withMenu) this.menu.close();
    }

    toggleMenu() {
        if (!this.withMenu) return;

        if (!this.menu.isOpen){
            let children = this.menu.box.get_children();
            for (var i in children) {
                this.menu.box.remove_actor(children[i]);
            }
            let menuItem;
            menuItem = new ApplicationContextMenuItem(this, _("Add to panel"), "add_to_panel", "list-add");
            this.menu.addMenuItem(menuItem);
            if (USER_DESKTOP_PATH){
                menuItem = new ApplicationContextMenuItem(this, _("Add to desktop"), "add_to_desktop", "computer");
                this.menu.addMenuItem(menuItem);
            }
            if (AppFavorites.getAppFavorites().isFavorite(this.app.get_id())){
                menuItem = new ApplicationContextMenuItem(this, _("Remove from favorites"), "remove_from_favorites", "starred");
                this.menu.addMenuItem(menuItem);
            }else{
                menuItem = new ApplicationContextMenuItem(this, _("Add to favorites"), "add_to_favorites", "non-starred");
                this.menu.addMenuItem(menuItem);
            }
            if (this.appsMenuButton._canUninstallApps) {
                menuItem = new ApplicationContextMenuItem(this, _("Uninstall"), "uninstall", "edit-delete");
                this.menu.addMenuItem(menuItem);
            }
            if (this.appsMenuButton._isBumblebeeInstalled) {
                menuItem = new ApplicationContextMenuItem(this, _("Run with NVIDIA GPU"), "run_with_nvidia_gpu", "cpu");
                this.menu.addMenuItem(menuItem);
            }
        }
        this.menu.toggle();
    }

    _subMenuOpenStateChanged() {
        if (this.menu.isOpen) {
            this.appsMenuButton._activeContextMenuParent = this;
            this.appsMenuButton._scrollToButton(this.menu);
        } else {
            this.appsMenuButton._activeContextMenuItem = null;
            this.appsMenuButton._activeContextMenuParent = null;
        }
    }

    get _contextIsOpen() {
        return this.menu.isOpen;
    }

    destroy() {
        this.label.destroy();

        if (this.icon) {
            this.icon.destroy();
        }

        if (this.withMenu) {
            this.menu.destroy();
        }

        PopupMenu.PopupBaseMenuItem.prototype.destroy.call(this);
    }
};

class TransientButton extends PopupMenu.PopupBaseMenuItem {
    constructor(appsMenuButton, pathOrCommand) {
        super({hover: false});
        let displayPath = pathOrCommand;
        if (pathOrCommand.charAt(0) == '~') {
            pathOrCommand = pathOrCommand.slice(1);
            pathOrCommand = GLib.get_home_dir() + pathOrCommand;
        }

        this.isPath = pathOrCommand.substr(pathOrCommand.length - 1) == '/';
        if (this.isPath) {
            this.path = pathOrCommand;
        } else {
            let n = pathOrCommand.lastIndexOf('/');
            if (n != 1) {
                this.path = pathOrCommand.substr(0, n);
            }
        }

        this.pathOrCommand = pathOrCommand;

        this.appsMenuButton = appsMenuButton;

        // We need this fake app to help appEnterEvent/appLeaveEvent
        // work with our search result.
        this.app = {
            get_app_info: {
                get_filename() {
                    return pathOrCommand;
                }
            },
            get_id() {
                return -1;
            },
            get_description() {
                return this.pathOrCommand;
            },
            get_name() {
                return '';
            }
        };



        this.file = Gio.file_new_for_path(this.pathOrCommand);

        try {
            this.handler = this.file.query_default_handler(null);
            let contentType = Gio.content_type_guess(this.pathOrCommand, null);
            let themedIcon = Gio.content_type_get_icon(contentType[0]);
            this.icon = new St.Icon({gicon: themedIcon, icon_size: APPLICATION_ICON_SIZE, icon_type: St.IconType.FULLCOLOR });
            this.actor.set_style_class_name('menu-application-button');
        } catch (e) {
            this.handler = null;
            let iconName = this.isPath ? 'folder' : 'unknown';
            this.icon = new St.Icon({icon_name: iconName, icon_size: APPLICATION_ICON_SIZE, icon_type: St.IconType.FULLCOLOR});
            // @todo Would be nice to indicate we don't have a handler for this file.
            this.actor.set_style_class_name('menu-application-button');
        }

        this.addActor(this.icon);

        this.label = new St.Label({ text: displayPath, style_class: 'menu-application-button-label' });
        this.label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this.label.set_style(MAX_BUTTON_WIDTH);
        this.addActor(this.label);
        this.isDraggableApp = false;
    }

    _onButtonReleaseEvent (actor, event) {
        if (event.get_button()==1){
            this.activate(event);
        }
        return true;
    }

    activate(event) {
        if (this.handler != null) {
            this.handler.launch([this.file], null);
        } else {
            // Try anyway, even though we probably shouldn't.
            try {
                Util.spawn(['gvfs-open', this.file.get_uri()]);
            } catch (e) {
                global.logError("No handler available to open " + this.file.get_uri());
            }

        }

        this.appsMenuButton.menu.close();
    }
}

class ApplicationButton extends GenericApplicationButton {
    constructor(appsMenuButton, app, showIcon) {
        super(appsMenuButton, app, true);
        this.category = [];
        this.actor.set_style_class_name('menu-application-button');

        if (showIcon) {
            this.icon = this.app.create_icon_texture(APPLICATION_ICON_SIZE);
            this.addActor(this.icon);
        }
        this.name = this.app.get_name();
        this.label = new St.Label({ text: this.name, style_class: 'menu-application-button-label' });
        this.label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this.label.set_style(MAX_BUTTON_WIDTH);
        this.addActor(this.label);
        this._draggable = DND.makeDraggable(this.actor);
        this._draggable.connect('drag-end', Lang.bind(this, this._onDragEnd));
        this.isDraggableApp = true;
        this.actor.label_actor = this.label;
    }

    get_app_id() {
        return this.app.get_id();
    }

    getDragActor() {
        let favorites = AppFavorites.getAppFavorites().getFavorites();
        let nbFavorites = favorites.length;
        let monitorHeight = Main.layoutManager.primaryMonitor.height;
        let real_size = (0.7 * monitorHeight) / nbFavorites;
        let icon_size = 0.6 * real_size / global.ui_scale;
        if (icon_size > MAX_FAV_ICON_SIZE)
            icon_size = MAX_FAV_ICON_SIZE;
        return this.app.create_icon_texture(icon_size);
    }

    // Returns the original actor that should align with the actor
    // we show as the item is being dragged.
    getDragActorSource() {
        return this.actor;
    }

    _onDragEnd() {
        this.appsMenuButton.favoritesBox._delegate._clearDragPlaceholder();
    }
}

class SearchProviderResultButton extends PopupMenu.PopupBaseMenuItem {
    constructor(appsMenuButton, provider, result) {
        super({hover: false});
        this.provider = provider;
        this.result = result;

        this.appsMenuButton = appsMenuButton;
        this.actor.set_style_class_name('menu-application-button');

        // We need this fake app to help appEnterEvent/appLeaveEvent
        // work with our search result.
        this.app = {
            get_app_info: {
                get_filename() {
                    return result.id;
                }
            },
            get_id() {
                return -1;
            },
            get_description() {
                return result.description;
            },
            get_name() {
                return result.label;
            }
        };

        this.icon = null;
        if (result.icon){
            this.icon = result.icon;
        }else if (result.icon_app){
            this.icon = result.icon_app.create_icon_texture(APPLICATION_ICON_SIZE);
        }else if (result.icon_filename){
            this.icon = new St.Icon({gicon: new Gio.FileIcon({file: Gio.file_new_for_path(result.icon_filename)}), icon_size: APPLICATION_ICON_SIZE});
        }

        if (this.icon){
            this.addActor(this.icon);
        }
        this.label = new St.Label({ text: result.label, style_class: 'menu-application-button-label' });
        this.addActor(this.label);
        this.isDraggableApp = false;
    }

    _onButtonReleaseEvent (actor, event) {
        if (event.get_button() == 1){
            this.activate(event);
        }
        return true;
    }

    activate(event) {
        try{
            this.provider.on_result_selected(this.result);
            this.appsMenuButton.menu.close();
        }
        catch(e)
        {
            global.logError(e);
        }
    }
}

class PlaceButton extends PopupMenu.PopupBaseMenuItem {
    constructor(appsMenuButton, place, button_name, showIcon) {
        super({hover: false});
        this.appsMenuButton = appsMenuButton;
        this.place = place;
        this.button_name = button_name;
        this.actor.set_style_class_name('menu-application-button');
        this.actor._delegate = this;

        this.label = new St.Label({ text: this.button_name, style_class: 'menu-application-button-label' });
        this.label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this.label.set_style(MAX_BUTTON_WIDTH);
        if (showIcon) {
            this.icon = place.iconFactory(APPLICATION_ICON_SIZE);
            if (!this.icon)
                this.icon = new St.Icon({icon_name: "folder", icon_size: APPLICATION_ICON_SIZE, icon_type: St.IconType.FULLCOLOR});
            if (this.icon)
                this.addActor(this.icon);
        }
        this.addActor(this.label);
    }

    _onButtonReleaseEvent (actor, event) {
        if (event.get_button()==1){
            this.place.launch();
            this.appsMenuButton.menu.close();
        }
    }

    activate(event) {
        this.place.launch();
        this.appsMenuButton.menu.close();
    }
}

class RecentContextMenuItem extends PopupMenu.PopupBaseMenuItem {
    constructor(recentButton, label, is_default, callback) {
        super({focusOnHover: false});

        this._recentButton = recentButton;
        this._callback = callback;
        this.label = new St.Label({ text: label });
        this.addActor(this.label);

        if (is_default)
            this.label.style = "font-weight: bold;";
    }

    activate (event) {
        this._callback();
        return false;
    }
}

class RecentButton extends PopupMenu.PopupBaseMenuItem {
    constructor(appsMenuButton, recent, showIcon) {
        super({hover: false});
        this.mimeType = recent.mimeType;
        this.uri = recent.uri;
        this.uriDecoded = recent.uriDecoded;
        this.appsMenuButton = appsMenuButton;
        this.button_name = recent.name;

        this.menu = null;

        this.actor.set_style_class_name('menu-application-button');
        this.actor._delegate = this;
        this.label = new St.Label({ text: this.button_name, style_class: 'menu-application-button-label' });
        this.label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this.label.set_style(MAX_BUTTON_WIDTH);
        if (showIcon) {
            this.icon = recent.createIcon(APPLICATION_ICON_SIZE);
            this.addActor(this.icon);
        }
        this.addActor(this.label);
    }

    _onButtonReleaseEvent (actor, event) {
        if (event.get_button()==1){
            this.activate(event);
        }
        if (event.get_button()==3){
            this.activateContextMenus(event);
        }
        return true;
    }

    activate(event) {
        try {
            Gio.app_info_launch_default_for_uri(this.uri, global.create_app_launch_context());
            this.appsMenuButton.menu.close();
        } catch (e) {
            let source = new MessageTray.SystemNotificationSource();
            Main.messageTray.add(source);
            let notification = new MessageTray.Notification(source,
                                                            _("This file is no longer available"),
                                                            e.message);
            notification.setTransient(true);
            notification.setUrgency(MessageTray.Urgency.NORMAL);
            source.notify(notification);
        }
    }

    activateContextMenus(event) {
        let menu = this.appsMenuButton.recentContextMenu;

        if (menu != null && menu.sourceActor._delegate != this)
            this.appsMenuButton.closeContextMenus(this, true);

        this.toggleMenu();
    }

    closeMenu() {
        this.menu = null;
        this.menu.close();
    }

    hasLocalPath(file) {
        return file.is_native() || file.get_path() != null;
    }

    toggleMenu() {
        if (this.appsMenuButton.recentContextMenu == null) {
            this.appsMenuButton.createRecentContextMenu(this.actor);
        }

        let menu = this.appsMenuButton.recentContextMenu;
        this.menu = menu;

        if (!menu.isOpen) {
            let parent = menu.actor.get_parent();
            if (parent != null) {
                parent.remove_child(menu.actor);
            }

            menu.sourceActor = this.actor;
            this.actor.get_parent().insert_child_above(menu.actor, this.actor);

            let children = menu.box.get_children();
            for (var i in children) {
                menu.box.remove_actor(children[i]);
            }

            let menuItem;

            menuItem = new PopupMenu.PopupMenuItem(_("Open with"), { reactive: false });
            menuItem.actor.style = "font-weight: bold";
            menu.addMenuItem(menuItem);

            let file = Gio.File.new_for_uri(this.uri);

            let default_info = Gio.AppInfo.get_default_for_type(this.mimeType, !this.hasLocalPath(file));

            if (default_info) {
                menuItem = new RecentContextMenuItem(this,
                                                     default_info.get_display_name(),
                                                     false,
                                                     Lang.bind(this, function() {
                                                         default_info.launch([file], null, null);
                                                         this.toggleMenu();
                                                         this.appsMenuButton.menu.close();
                                                     }));
                menu.addMenuItem(menuItem);
            }

            let infos = Gio.AppInfo.get_all_for_type(this.mimeType);

            for (let i = 0; i < infos.length; i++) {
                let info = infos[i];

                file = Gio.File.new_for_uri(this.uri);

                if (!this.hasLocalPath(file) && !info.supports_uris())
                    continue;

                if (info.equal(default_info))
                    continue;

                menuItem = new RecentContextMenuItem(this,
                                                     info.get_display_name(),
                                                     false,
                                                     Lang.bind(this, function() {
                                                         info.launch([file], null, null);
                                                         this.toggleMenu();
                                                         this.appsMenuButton.menu.close();
                                                     }));
                menu.addMenuItem(menuItem);
            }

            if (GLib.find_program_in_path ("nemo-open-with") != null) {
                menuItem = new RecentContextMenuItem(this,
                                                     _("Other application..."),
                                                     false,
                                                     Lang.bind(this, function() {
                                                         Util.spawnCommandLine("nemo-open-with " + this.uri);
                                                         this.toggleMenu();
                                                         this.appsMenuButton.menu.close();
                                                     }));
                menu.addMenuItem(menuItem);
            }
        }
        this.appsMenuButton.recentContextMenu.toggle();
    }

    get _contextIsOpen() {
        return this.menu != null && this.menu.isOpen;
    }

    destroy() {
        this.file = null;
        this.appsMenuButton = null;
        this.label.destroy();
        if (this.icon)
            this.icon.destroy();

        PopupMenu.PopupBaseMenuItem.prototype.destroy.call(this);
    }
}

class NoRecentDocsButton extends PopupMenu.PopupBaseMenuItem {
    constructor(label, icon, reactive, callback) {
        super({hover: false});
        this.actor.set_style_class_name('menu-application-button');
        this.actor._delegate = this;
        this.button_name = "";

        this.label = new St.Label({ text: label, style_class: 'menu-application-button-label' });
        this.label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this.label.set_style(MAX_BUTTON_WIDTH);

        if (icon != null) {
            let icon_actor = new St.Icon({ icon_name: icon, icon_type: St.IconType.FULLCOLOR, icon_size: APPLICATION_ICON_SIZE});
            this.addActor(icon_actor);
        }

        this.addActor(this.label);

        this.actor.reactive = reactive;
        this.callback = callback;
    }

    _onButtonReleaseEvent (actor, event) {
        if (event.get_button() == 1) {
            this.callback();
        }
    }
}

class RecentClearButton extends PopupMenu.PopupBaseMenuItem {
    constructor(appsMenuButton) {
        super({hover: false});
        this.appsMenuButton = appsMenuButton;
        this.actor.set_style_class_name('menu-application-button');
        this.button_name = _("Clear list");
        this.actor._delegate = this;
        this.label = new St.Label({ text: this.button_name, style_class: 'menu-application-button-label' });
        this.icon = new St.Icon({ icon_name: 'edit-clear', icon_type: St.IconType.SYMBOLIC, icon_size: APPLICATION_ICON_SIZE });
        this.addActor(this.icon);
        this.addActor(this.label);
    }

    _onButtonReleaseEvent (actor, event) {
        if (event.get_button()==1){
            this.activate(event);
        }
    }

    activate(event) {
        this.appsMenuButton.menu.close();
        let GtkRecent = new Gtk.RecentManager();
        GtkRecent.purge_items();
    }
}

class CategoryButton extends PopupMenu.PopupBaseMenuItem {
    constructor(category, showIcon) {
        super({hover: false});

        this.actor.set_style_class_name('menu-category-button');
        var label;
        let icon = null;
        if (category) {
            if (showIcon) {
                icon = category.get_icon();
                if (icon && icon.get_names)
                    this.icon_name = icon.get_names().toString();
                else
                    this.icon_name = "";
            } else {
                this.icon_name = "";
            }
            label = category.get_name();
        } else
            label = _("All Applications");

        this.actor._delegate = this;
        this.label = new St.Label({ text: label, style_class: 'menu-category-button-label' });
        if (category && this.icon_name) {
            this.icon = new St.Icon({gicon: icon, icon_size: CATEGORY_ICON_SIZE, icon_type: St.IconType.FULLCOLOR});

            if (this.icon)
                this.addActor(this.icon);
        }
        this.actor.accessible_role = Atk.Role.LIST_ITEM;
        this.addActor(this.label);
    }
}

class PlaceCategoryButton extends PopupMenu.PopupBaseMenuItem {
    constructor(category, showIcon) {
        super({hover: false});
        this.actor.set_style_class_name('menu-category-button');
        this.actor._delegate = this;
        this.label = new St.Label({ text: _("Places"), style_class: 'menu-category-button-label' });
        if (showIcon) {
            this.icon = new St.Icon({icon_name: "folder", icon_size: CATEGORY_ICON_SIZE, icon_type: St.IconType.FULLCOLOR});
            this.addActor(this.icon);
        } else {
            this.icon = null;
        }
        this.addActor(this.label);
    }
}

class RecentCategoryButton extends PopupMenu.PopupBaseMenuItem {
    constructor(category, showIcon) {
        super({hover: false});
        this.actor.set_style_class_name('menu-category-button');
        this.actor._delegate = this;
        this.label = new St.Label({ text: _("Recent Files"), style_class: 'menu-category-button-label' });
        if (showIcon) {
            this.icon = new St.Icon({icon_name: "folder-recent", icon_size: CATEGORY_ICON_SIZE, icon_type: St.IconType.FULLCOLOR});
            this.addActor(this.icon);
        } else {
            this.icon = null;
        }
        this.addActor(this.label);
    }
}

class FavoritesButton extends GenericApplicationButton {
    constructor(appsMenuButton, app, nbFavorites) {
        super(appsMenuButton, app);
        let monitorHeight = Main.layoutManager.primaryMonitor.height;
        let real_size = (0.7 * monitorHeight) / nbFavorites;
        let icon_size = 0.6 * real_size / global.ui_scale;
        if (icon_size > MAX_FAV_ICON_SIZE)
            icon_size = MAX_FAV_ICON_SIZE;

        this.actor.add_style_class_name('menu-favorites-button');
        let icon = app.create_icon_texture(icon_size);

        this.addActor(icon);

        this._draggable = DND.makeDraggable(this.actor);
        this._draggable.connect('drag-end', Lang.bind(this, this._onDragEnd));
        this.isDraggableApp = true;
    }

    _onDragEnd() {
        this.actor.get_parent()._delegate._clearDragPlaceholder();
    }

    get_app_id() {
        return this.app.get_id();
    }

    getDragActor() {
        return new Clutter.Clone({ source: this.actor });
    }

    // Returns the original actor that should align with the actor
    // we show as the item is being dragged.
    getDragActorSource() {
        return this.actor;
    }
}

class SystemButton extends PopupMenu.PopupBaseMenuItem {
    constructor(icon, nbFavorites, name, desc) {
        super({hover: false});

        this.name = name;
        this.desc = desc;

        let monitorHeight = Main.layoutManager.primaryMonitor.height;
        let real_size = (0.7 * monitorHeight) / nbFavorites;
        let icon_size = 0.6 * real_size / global.ui_scale;
        if (icon_size > MAX_FAV_ICON_SIZE)
            icon_size = MAX_FAV_ICON_SIZE;
        this.actor.add_style_class_name('menu-favorites-button');

        this.icon = new St.Icon({icon_name: icon, icon_size: icon_size, icon_type: St.IconType.FULLCOLOR});

        this.addActor(this.icon);
    }

    _onButtonReleaseEvent(actor, event) {
        if (event.get_button() == 1) {
            this.activate();
        }
    }
}

class CategoriesApplicationsBox {
    constructor() {
        this.actor = new St.BoxLayout();
        this.actor._delegate = this;
    }

    acceptDrop (source, actor, x, y, time) {
        if (source instanceof FavoritesButton){
            source.actor.destroy();
            actor.destroy();
            AppFavorites.getAppFavorites().removeFavorite(source.app.get_id());
            return true;
        }
        return false;
    }

    handleDragOver (source, actor, x, y, time) {
        if (source instanceof FavoritesButton)
            return DND.DragMotionResult.POINTING_DROP;

        return DND.DragMotionResult.CONTINUE;
    }
}

class FavoritesBox {
    constructor() {
        this.actor = new St.BoxLayout({ vertical: true });
        this.actor._delegate = this;

        this._dragPlaceholder = null;
        this._dragPlaceholderPos = -1;
        this._animatingPlaceholdersCount = 0;
    }

    _clearDragPlaceholder() {
        if (this._dragPlaceholder) {
            this._dragPlaceholder.animateOutAndDestroy();
            this._dragPlaceholder = null;
            this._dragPlaceholderPos = -1;
        }
    }

    handleDragOver (source, actor, x, y, time) {
        let app = source.app;

        let favorites = AppFavorites.getAppFavorites().getFavorites();
        let numFavorites = favorites.length;

        let favPos = favorites.indexOf(app);

        let children = this.actor.get_children();
        let numChildren = children.length;
        let boxHeight = this.actor.height;

        // Keep the placeholder out of the index calculation; assuming that
        // the remove target has the same size as "normal" items, we don't
        // need to do the same adjustment there.
        if (this._dragPlaceholder) {
            boxHeight -= this._dragPlaceholder.actor.height;
            numChildren--;
        }

        let pos = Math.round(y * numChildren / boxHeight);

        if (pos != this._dragPlaceholderPos && pos <= numFavorites) {
            if (this._animatingPlaceholdersCount > 0) {
                let appChildren = children.filter(function(actor) {
                    return (actor._delegate instanceof FavoritesButton);
                });
                this._dragPlaceholderPos = children.indexOf(appChildren[pos]);
            } else {
                this._dragPlaceholderPos = pos;
            }

            // Don't allow positioning before or after self
            if (favPos != -1 && (pos == favPos || pos == favPos + 1)) {
                if (this._dragPlaceholder) {
                    this._dragPlaceholder.animateOutAndDestroy();
                    this._animatingPlaceholdersCount++;
                    this._dragPlaceholder.actor.connect('destroy',
                        Lang.bind(this, function() {
                            this._animatingPlaceholdersCount--;
                        }));
                }
                this._dragPlaceholder = null;

                return DND.DragMotionResult.CONTINUE;
            }

            // If the placeholder already exists, we just move
            // it, but if we are adding it, expand its size in
            // an animation
            let fadeIn;
            if (this._dragPlaceholder) {
                this._dragPlaceholder.actor.destroy();
                fadeIn = false;
            } else {
                fadeIn = true;
            }

            this._dragPlaceholder = new DND.GenericDragPlaceholderItem();
            this._dragPlaceholder.child.set_width (source.actor.height);
            this._dragPlaceholder.child.set_height (source.actor.height);
            this.actor.insert_child_at_index(this._dragPlaceholder.actor,
                                             this._dragPlaceholderPos);
            if (fadeIn)
                this._dragPlaceholder.animateIn();
        }

        let id = app.get_id();
        let favoritesMap = AppFavorites.getAppFavorites().getFavoriteMap();
        let srcIsFavorite = (id in favoritesMap);

        if (!srcIsFavorite)
            return DND.DragMotionResult.COPY_DROP;

        return DND.DragMotionResult.MOVE_DROP;
    }

    // Draggable target interface
    acceptDrop (source, actor, x, y, time) {
        let app = source.app;

        let id = app.get_id();

        let favorites = AppFavorites.getAppFavorites().getFavoriteMap();

        let srcIsFavorite = (id in favorites);

        let favPos = 0;
        let children = this.actor.get_children();
        for (let i = 0; i < this._dragPlaceholderPos; i++) {
            if (this._dragPlaceholder &&
                children[i] == this._dragPlaceholder.actor)
                continue;

            if (!(children[i]._delegate instanceof FavoritesButton)) continue;

            let childId = children[i]._delegate.app.get_id();
            if (childId == id)
                continue;
            if (childId in favorites)
                favPos++;
        }

        Meta.later_add(Meta.LaterType.BEFORE_REDRAW, Lang.bind(this,
            function () {
                let appFavorites = AppFavorites.getAppFavorites();
                if (srcIsFavorite)
                    appFavorites.moveFavoriteToPos(id, favPos);
                else
                    appFavorites.addFavoriteAtPos(id, favPos);
                return false;
            }));

        return true;
    }
}

class CinnamonMenuApplet extends Applet.TextIconApplet {
    constructor(orientation, panel_height, instance_id) {
        super(orientation, panel_height, instance_id);

        this.setAllowedLayout(Applet.AllowedLayout.BOTH);

        this.initial_load_done = false;

        this.set_applet_tooltip(_("Menu"));
        this.menuManager = new PopupMenu.PopupMenuManager(this);
        this.menu = new Applet.AppletPopupMenu(this, orientation);
        this.menuManager.addMenu(this.menu);
        this.orientation = orientation;

        this.actor.connect('key-press-event', Lang.bind(this, this._onSourceKeyPress));

        this.settings = new Settings.AppletSettings(this, "menu@cinnamon.org", instance_id);

        this.settings.bind("show-places", "showPlaces", this._refreshBelowApps);

        this._appletEnterEventId = 0;
        this._appletLeaveEventId = 0;
        this._appletHoverDelayId = 0;

        this.settings.bind("hover-delay", "hover_delay_ms", this._updateActivateOnHover);
        this.settings.bind("activate-on-hover", "activateOnHover", this._updateActivateOnHover);
        this._updateActivateOnHover();

        this.menu.setCustomStyleClass('menu-background');
        this.menu.connect('open-state-changed', Lang.bind(this, this._onOpenStateChanged));

        this.settings.bind("menu-custom", "menuCustom", this._updateIconAndLabel);
        this.settings.bind("menu-icon", "menuIcon", this._updateIconAndLabel);
        this.settings.bind("menu-label", "menuLabel", this._updateIconAndLabel);
        this.settings.bind("overlay-key", "overlayKey", this._updateKeybinding);
        this.settings.bind("show-category-icons", "showCategoryIcons", this._refreshAll);
        this.settings.bind("show-application-icons", "showApplicationIcons", this._refreshAll);
        this.settings.bind("favbox-show", "favBoxShow", this._favboxtoggle);
        this.settings.bind("enable-animation", "enableAnimation", null);
        this.settings.bind("favbox-min-height", "favBoxMinHeight", this._recalc_height);

        this._updateKeybinding();

        Main.themeManager.connect("theme-set", Lang.bind(this, this._updateIconAndLabel));
        this._updateIconAndLabel();

        this._searchInactiveIcon = new St.Icon({ style_class: 'menu-search-entry-icon',
            icon_name: 'edit-find',
            icon_type: St.IconType.SYMBOLIC });
        this._searchActiveIcon = new St.Icon({ style_class: 'menu-search-entry-icon',
            icon_name: 'edit-clear',
            icon_type: St.IconType.SYMBOLIC });
        this._searchIconClickedId = 0;
        this._applicationsButtons = [];
        this._applicationsButtonFromApp = {};
        this._favoritesButtons = [];
        this._placesButtons = [];
        this._transientButtons = [];
        this.recentButton = null;
        this._recentButtons = [];
        this._categoryButtons = [];
        this._searchProviderButtons = [];
        this._selectedItemIndex = null;
        this._previousSelectedActor = null;
        this._previousVisibleIndex = null;
        this._previousTreeSelectedActor = null;
        this._activeContainer = null;
        this._activeActor = null;
        this._applicationsBoxWidth = 0;
        this.menuIsOpening = false;
        this._knownApps = new Set(); // Used to keep track of apps that are already installed, so we can highlight newly installed ones
        this._appsWereRefreshed = false;
        this._canUninstallApps = GLib.file_test("/usr/bin/cinnamon-remove-application", GLib.FileTest.EXISTS);
        this._isBumblebeeInstalled = GLib.file_test("/usr/bin/optirun", GLib.FileTest.EXISTS);
        this.RecentManager = DocInfo.getDocManager();
        this.privacy_settings = new Gio.Settings( {schema_id: PRIVACY_SCHEMA} );
        this.noRecentDocuments = true;
        this._activeContextMenuParent = null;
        this._activeContextMenuItem = null;
        this._display();
        appsys.connect('installed-changed', Lang.bind(this, this.onAppSysChanged));
        AppFavorites.getAppFavorites().connect('changed', Lang.bind(this, this._refreshFavs));
        Main.placesManager.connect('places-updated', Lang.bind(this, this._refreshBelowApps));
        this.RecentManager.connect('changed', Lang.bind(this, this._refreshRecent));
        this.privacy_settings.connect("changed::" + REMEMBER_RECENT_KEY, Lang.bind(this, this._refreshRecent));
        this._fileFolderAccessActive = false;
        this._pathCompleter = new Gio.FilenameCompleter();
        this._pathCompleter.set_dirs_only(false);
        this.lastAcResults = [];
        this.settings.bind("search-filesystem", "searchFilesystem");
        this.refreshing = false; // used as a flag to know if we're currently refreshing (so we don't do it more than once concurrently)

        this.recentContextMenu = null;
        this.appsContextMenu = null;

        this.lastSelectedCategory = null;

        // We shouldn't need to call refreshAll() here... since we get a "icon-theme-changed" signal when CSD starts.
        // The reason we do is in case the Cinnamon icon theme is the same as the one specificed in GTK itself (in .config)
        // In that particular case we get no signal at all.
        this._refreshAll();

        this.set_show_label_in_vertical_panels(false);
    }

    _updateKeybinding() {
        Main.keybindingManager.addHotKey("overlay-key-" + this.instance_id, this.overlayKey, Lang.bind(this, function() {
            if (!Main.overview.visible && !Main.expo.visible)
                this.menu.toggle_with_options(this.enableAnimation);
        }));
    }

    onAppSysChanged() {
        if (this.refreshing == false) {
            this.refreshing = true;
            Mainloop.timeout_add_seconds(1, Lang.bind(this, this._refreshAll));
        }
    }

    _refreshAll() {
        try {
            this._refreshApps();
            this._refreshFavs();
            this._refreshSystemButtons();
            this._refreshPlaces();
            this._refreshRecent();

            this._resizeApplicationsBox();
        }
        catch (exception) {
            global.log(exception);
        }
        this.refreshing = false;
    }

    _refreshBelowApps() {
        this._refreshPlaces();
        this._refreshRecent();

        this._resizeApplicationsBox();
    }

    openMenu() {
        if (!this._applet_context_menu.isOpen) {
            this.menu.open(this.enableAnimation);
        }
    }

    _clearDelayCallbacks() {
        if (this._appletHoverDelayId > 0) {
            Mainloop.source_remove(this._appletHoverDelayId);
            this._appletHoverDelayId = 0;
        }
        if (this._appletLeaveEventId > 0) {
            this.actor.disconnect(this._appletLeaveEventId);
            this._appletLeaveEventId = 0;
        }

        return false;
    }

    _updateActivateOnHover() {
        if (this._appletEnterEventId > 0) {
            this.actor.disconnect(this._appletEnterEventId);
            this._appletEnterEventId = 0;
        }

        this._clearDelayCallbacks();

        if (this.activateOnHover) {
            this._appletEnterEventId = this.actor.connect('enter-event', Lang.bind(this, function() {
                if (this.hover_delay_ms > 0) {
                    this._appletLeaveEventId = this.actor.connect('leave-event', Lang.bind(this, this._clearDelayCallbacks));
                    this._appletHoverDelayId = Mainloop.timeout_add(this.hover_delay_ms,
                        Lang.bind(this, function() {
                            this.openMenu();
                            this._clearDelayCallbacks();
                        }));
                } else {
                    this.openMenu();
                }
            }));
        }
    }

    _recalc_height() {
        let scrollBoxHeight = (this.leftBox.get_allocation_box().y2-this.leftBox.get_allocation_box().y1) -
                               (this.searchBox.get_allocation_box().y2-this.searchBox.get_allocation_box().y1);

        this.applicationsScrollBox.style = "height: "+scrollBoxHeight / global.ui_scale +"px;";
        let monitor = Main.layoutManager.monitors[this.panel.monitorIndex];
        let minSize = Math.max(this.favBoxMinHeight * global.ui_scale, this.categoriesBox.height - this.systemButtonsBox.height);
        let maxSize = monitor.height - (this.systemButtonsBox.height * 2);
        let size = Math.min(minSize, maxSize);
        this.favoritesScrollBox.set_height(size);
    }

    on_orientation_changed (orientation) {
        this.orientation = orientation;

        this.menu.destroy();
        this.menu = new Applet.AppletPopupMenu(this, orientation);
        this.menuManager.addMenu(this.menu);

        this.menu.setCustomStyleClass('menu-background');
        this.menu.connect('open-state-changed', Lang.bind(this, this._onOpenStateChanged));
        this._display();

        if (this.initial_load_done)
            this._refreshAll();
        this._updateIconAndLabel();
    }

    on_applet_added_to_panel () {
        this.initial_load_done = true;
    }

    on_applet_removed_from_panel () {
        Main.keybindingManager.removeHotKey("overlay-key-" + this.instance_id);
    }

    _launch_editor() {
        Util.spawnCommandLine("cinnamon-menu-editor");
    }

    on_applet_clicked(event) {
        this.menu.toggle_with_options(this.enableAnimation);
    }

    _onSourceKeyPress(actor, event) {
        let symbol = event.get_key_symbol();

        if (symbol == Clutter.KEY_space || symbol == Clutter.KEY_Return) {
            this.menu.toggle();
            return true;
        } else if (symbol == Clutter.KEY_Escape && this.menu.isOpen) {
            this.menu.close();
            return true;
        } else if (symbol == Clutter.KEY_Down) {
            if (!this.menu.isOpen)
                this.menu.toggle();
            this.menu.actor.navigate_focus(this.actor, Gtk.DirectionType.DOWN, false);
            return true;
        } else
            return false;
    }

    _onOpenStateChanged(menu, open) {
        if (open) {
            this.menuIsOpening = true;
            this.actor.add_style_pseudo_class('active');
            global.stage.set_key_focus(this.searchEntry);
            this._selectedItemIndex = null;
            this._activeContainer = null;
            this._activeActor = null;

            this.lastSelectedCategory = null;

            let n = Math.min(this._applicationsButtons.length,
                             INITIAL_BUTTON_LOAD);
            for (let i = 0; i < n; i++) {
                this._applicationsButtons[i].actor.show();
            }
            this._allAppsCategoryButton.actor.style_class = "menu-category-button-selected";
            this.favBoxIter.reloadVisible();

            Mainloop.idle_add(Lang.bind(this, this._initial_cat_selection, n));
        } else {
            this.actor.remove_style_pseudo_class('active');
            if (this.searchActive) {
                this.resetSearch();
            }
            this.selectedAppTitle.set_text("");
            this.selectedAppDescription.set_text("");
            this._previousTreeSelectedActor = null;
            this._previousSelectedActor = null;
            this.closeContextMenus(null, false);

            this._clearAllSelections(true);
            this._scrollToButton(this.favBoxIter.getFirstVisible()._delegate, this.favoritesScrollBox);
            this.destroyVectorBox();
        }
    }

    _initial_cat_selection (start_index) {
        let n = this._applicationsButtons.length;
        for (let i = start_index; i < n; i++) {
            this._applicationsButtons[i].actor.show();
        }
    }

    destroy() {
        this.actor._delegate = null;
        this.menu.destroy();
        this.actor.destroy();
        this.emit('destroy');
    }

    _favboxtoggle() {
        if (!this.favBoxShow) {
            this.leftPane.hide();
        } else {
            this.leftPane.show();
        }
    }

    _updateIconAndLabel(){
        try {
            if (this.menuCustom) {
                if (this.menuIcon == "") {
                    this.set_applet_icon_name("");
                } else if (GLib.path_is_absolute(this.menuIcon) && GLib.file_test(this.menuIcon, GLib.FileTest.EXISTS)) {
                    if (this.menuIcon.search("-symbolic") != -1)
                        this.set_applet_icon_symbolic_path(this.menuIcon);
                    else
                        this.set_applet_icon_path(this.menuIcon);
                } else if (Gtk.IconTheme.get_default().has_icon(this.menuIcon)) {
                    if (this.menuIcon.search("-symbolic") != -1)
                        this.set_applet_icon_symbolic_name(this.menuIcon);
                    else
                        this.set_applet_icon_name(this.menuIcon);
                }
            } else {
                let icon_name = global.settings.get_string('app-menu-icon-name');
                if (icon_name.search("-symbolic") != -1) {
                    this.set_applet_icon_symbolic_name(icon_name);
                }
                else {
                    this.set_applet_icon_name(icon_name);
                }
            }
        } catch(e) {
            global.logWarning("Could not load icon file \""+this.menuIcon+"\" for menu button");
        }

        // Hide the icon box if the icon name/path is empty
        if ((this.menuCustom && this.menuIcon == "") || (!this.menuCustom && global.settings.get_string('app-menu-icon-name') == "")){
            this._applet_icon_box.hide();
        } else {
            this._applet_icon_box.show();
        }

        // Hide the menu label in vertical panels
        if (this.orientation == St.Side.LEFT || this.orientation == St.Side.RIGHT)
        {
            this.set_applet_label("");
        }
        else {
            if (this.menuCustom) {
                if (this.menuLabel != "")
                    this.set_applet_label(_(this.menuLabel));
                else
                    this.set_applet_label("");
            }
            else {
                this.set_applet_label(global.settings.get_string('app-menu-label'));
            }
        }
    }

    _recentMenuOpenStateChanged(recentContextMenu) {
        if (recentContextMenu.isOpen) {
            this._activeContextMenuParent = recentContextMenu.sourceActor._delegate;
            this._scrollToButton(recentContextMenu);
        } else {
            this._activeContextMenuItem = null;
            this._activeContextMenuParent = null;
            for (let item in this._recentButtons) {
                if (this._recentButtons[item].menu) {
                    this._recentButtons[item].menu = null;
                }
            }
        }
    }

    createRecentContextMenu(actor) {
        let menu = new PopupMenu.PopupSubMenu(actor);
        menu.actor.set_style_class_name('menu-context-menu');
        menu.connect('open-state-changed', Lang.bind(this, this._recentMenuOpenStateChanged));
        this.recentContextMenu = menu;
    }

    _navigateContextMenu(button, symbol, ctrlKey) {
        if (symbol === Clutter.KEY_Menu || symbol === Clutter.Escape ||
            (ctrlKey && (symbol === Clutter.KEY_Return || symbol === Clutter.KP_Enter))) {
            button.activateContextMenus();
            return;
        }

        let minIndex = 0;
        let goUp = symbol === Clutter.KEY_Up;
        let nextActive = null;
        let menuItems = button.menu._getMenuItems(); // The context menu items

        // The first context menu item of a RecentButton is used just as a label.
        // So remove it from the iteration.
        if (button && button instanceof RecentButton) {
            minIndex = 1;
        }

        let menuItemsLength = menuItems.length;

        switch (symbol) {
            case Clutter.KEY_Page_Up:
                this._activeContextMenuItem = menuItems[minIndex];
                this._activeContextMenuItem.setActive(true);
                return;
            case Clutter.KEY_Page_Down:
                this._activeContextMenuItem = menuItems[menuItemsLength - 1];
                this._activeContextMenuItem.setActive(true);
                return;
        }

        if (!this._activeContextMenuItem) {
            if (symbol === Clutter.KEY_Return || symbol === Clutter.KP_Enter) {
                button.activate();
            } else {
                this._activeContextMenuItem = menuItems[goUp ? menuItemsLength - 1 : minIndex];
                this._activeContextMenuItem.setActive(true);
            }
            return;
        } else if (this._activeContextMenuItem &&
            (symbol === Clutter.KEY_Return || symbol === Clutter.KP_Enter)) {
            this._activeContextMenuItem.activate();
            this._activeContextMenuItem = null;
            return;
        }

        for (let i = minIndex; i < menuItemsLength; i++) {
            if (menuItems[i] === this._activeContextMenuItem) {
                let nextActiveIndex = (goUp ? i - 1 : i + 1);

                if (nextActiveIndex < minIndex) {
                    nextActiveIndex = menuItemsLength - 1;
                } else if (nextActiveIndex > menuItemsLength - 1) {
                    nextActiveIndex = minIndex;
                }

                nextActive = menuItems[nextActiveIndex];
                nextActive.setActive(true);
                this._activeContextMenuItem = nextActive;

                break;
            }
        }
    }

    _onMenuKeyPress(actor, event) {
        let symbol = event.get_key_symbol();
        let item_actor;
        let index = 0;
        this.appBoxIter.reloadVisible();
        this.catBoxIter.reloadVisible();
        this.favBoxIter.reloadVisible();
        this.sysBoxIter.reloadVisible();

        let keyCode = event.get_key_code();
        let modifierState = Cinnamon.get_event_state(event);

        /* check for a keybinding and quit early, otherwise we get a double hit
           of the keybinding callback */
        let action = global.display.get_keybinding_action(keyCode, modifierState);

        if (action == Meta.KeyBindingAction.CUSTOM) {
            return true;
        }

        index = this._selectedItemIndex;

        let ctrlKey = modifierState & Clutter.ModifierType.CONTROL_MASK;

        // If a context menu is open, hijack keyboard navigation and concentrate on the context menu.
        if (this._activeContextMenuParent && this._activeContextMenuParent._contextIsOpen &&
            this._activeContainer === this.applicationsBox &&
            (this._activeContextMenuParent instanceof ApplicationButton ||
                this._activeContextMenuParent instanceof RecentButton)) {
            let continueNavigation = false;
            switch (symbol) {
                case Clutter.KEY_Up:
                case Clutter.KEY_Down:
                case Clutter.KEY_Return:
                case Clutter.KP_Enter:
                case Clutter.KEY_Menu:
                case Clutter.KEY_Page_Up:
                case Clutter.KEY_Page_Down:
                case Clutter.Escape:
                    this._navigateContextMenu(this._activeContextMenuParent, symbol, ctrlKey);
                    break;
                case Clutter.KEY_Right:
                case Clutter.KEY_Left:
                case Clutter.Tab:
                case Clutter.ISO_Left_Tab:
                    continueNavigation = true;
                    break;
            }
            if (!continueNavigation)
                return true;
        }

        let navigationKey = true;
        let whichWay = "none";

        switch (symbol) {
            case Clutter.KEY_Up:
                whichWay = "up";
                if (this._activeContainer === this.favoritesBox && ctrlKey &&
                    (this.favoritesBox.get_child_at_index(index))._delegate instanceof FavoritesButton)
                    navigationKey = false;
                break;
            case Clutter.KEY_Down:
                whichWay = "down";
                if (this._activeContainer === this.favoritesBox && ctrlKey &&
                    (this.favoritesBox.get_child_at_index(index))._delegate instanceof FavoritesButton)
                    navigationKey = false;
                break;
            case Clutter.KEY_Page_Up:
                whichWay = "top"; break;
            case Clutter.KEY_Page_Down:
                whichWay = "bottom"; break;
            case Clutter.KEY_Right:
                if (!this.searchActive)
                    whichWay = "right";
                if (this._activeContainer === this.applicationsBox)
                    whichWay = "none";
                else if (this._activeContainer === this.categoriesBox && this.noRecentDocuments &&
                         (this.categoriesBox.get_child_at_index(index))._delegate instanceof RecentCategoryButton)
                    whichWay = "none";
                break;
            case Clutter.KEY_Left:
                if (!this.searchActive)
                    whichWay = "left";
                if (this._activeContainer === this.favoritesBox || this._activeContainer === this.systemButtonsBox)
                    whichWay = "none";
                else if (!this.favBoxShow &&
                            (this._activeContainer === this.categoriesBox || this._activeContainer === null))
                    whichWay = "none";
                break;
            case Clutter.Tab:
                if (!this.searchActive)
                    whichWay = "right";
                else
                    navigationKey = false;
                break;
            case Clutter.ISO_Left_Tab:
                if (!this.searchActive)
                    whichWay = "left";
                else
                    navigationKey = false;
                break;
            default:
                navigationKey = false;
        }

        if (navigationKey) {
            switch (this._activeContainer) {
                case null:
                    switch (whichWay) {
                        case "up":
                            this._activeContainer = this.categoriesBox;
                            item_actor = this.catBoxIter.getLastVisible();
                            this._scrollToButton(this.appBoxIter.getFirstVisible()._delegate);
                            break;
                        case "down":
                            this._activeContainer = this.categoriesBox;
                            item_actor = this.catBoxIter.getFirstVisible();
                            item_actor = this.catBoxIter.getNextVisible(item_actor);
                            this._scrollToButton(this.appBoxIter.getFirstVisible()._delegate);
                            break;
                        case "right":
                            this._activeContainer = this.applicationsBox;
                            item_actor = this.appBoxIter.getFirstVisible();
                            this._scrollToButton(item_actor._delegate);
                            break;
                        case "left":
                            if (this.favBoxShow) {
                                this._activeContainer = this.favoritesBox;
                                item_actor = this.favBoxIter.getFirstVisible();
                            } else {
                                this._activeContainer = this.applicationsBox;
                                item_actor = this.appBoxIter.getFirstVisible();
                                this._scrollToButton(item_actor._delegate);
                            }
                            break;
                        case "top":
                            this._activeContainer = this.categoriesBox;
                            item_actor = this.catBoxIter.getFirstVisible();
                            this._scrollToButton(this.appBoxIter.getFirstVisible()._delegate);
                            break;
                        case "bottom":
                            this._activeContainer = this.categoriesBox;
                            item_actor = this.catBoxIter.getLastVisible();
                            this._scrollToButton(this.appBoxIter.getFirstVisible()._delegate);
                            break;
                    }
                    break;
                case this.categoriesBox:
                    switch (whichWay) {
                        case "up":
                            this._previousTreeSelectedActor = this.categoriesBox.get_child_at_index(index);
                            this._previousTreeSelectedActor._delegate.isHovered = false;
                            item_actor = this.catBoxIter.getPrevVisible(this._activeActor);
                            this._scrollToButton(this.appBoxIter.getFirstVisible()._delegate);
                            break;
                        case "down":
                            this._previousTreeSelectedActor = this.categoriesBox.get_child_at_index(index);
                            this._previousTreeSelectedActor._delegate.isHovered = false;
                            item_actor = this.catBoxIter.getNextVisible(this._activeActor);
                            this._scrollToButton(this.appBoxIter.getFirstVisible()._delegate);
                            break;
                        case "right":
                            if ((this.categoriesBox.get_child_at_index(index))._delegate instanceof RecentCategoryButton &&
                                this.noRecentDocuments) {
                                if(this.favBoxShow) {
                                    this._previousSelectedActor = this.categoriesBox.get_child_at_index(index);
                                    item_actor = this.favBoxIter.getFirstVisible();
                                } else {
                                    item_actor = this.categoriesBox.get_child_at_index(index);
                                }
                            }
                            else {
                                item_actor = (this._previousVisibleIndex != null) ?
                                    this.appBoxIter.getVisibleItem(this._previousVisibleIndex) :
                                    this.appBoxIter.getFirstVisible();
                            }
                            break;
                        case "left":
                            if(this.favBoxShow) {
                                this._previousSelectedActor = this.categoriesBox.get_child_at_index(index);
                                item_actor = this.favBoxIter.getFirstVisible();
                                this._scrollToButton(item_actor._delegate, this.favoritesScrollBox);
                            } else {
                                if ((this.categoriesBox.get_child_at_index(index))._delegate instanceof RecentCategoryButton &&
                                    this.noRecentDocuments) {
                                    item_actor = this.categoriesBox.get_child_at_index(index);
                                } else {
                                    item_actor = (this._previousVisibleIndex != null) ?
                                        this.appBoxIter.getVisibleItem(this._previousVisibleIndex) :
                                        this.appBoxIter.getFirstVisible();
                                }
                            }
                            break;
                        case "top":
                            this._previousTreeSelectedActor = this.categoriesBox.get_child_at_index(index);
                            this._previousTreeSelectedActor._delegate.isHovered = false;
                            item_actor = this.catBoxIter.getFirstVisible();
                            this._scrollToButton(this.appBoxIter.getFirstVisible()._delegate);
                            break;
                        case "bottom":
                            this._previousTreeSelectedActor = this.categoriesBox.get_child_at_index(index);
                            this._previousTreeSelectedActor._delegate.isHovered = false;
                            item_actor = this.catBoxIter.getLastVisible();
                            this._scrollToButton(this.appBoxIter.getFirstVisible()._delegate);
                            break;
                    }
                    break;
                case this.applicationsBox:
                    switch (whichWay) {
                        case "up":
                            this._previousSelectedActor = this.applicationsBox.get_child_at_index(index);
                            item_actor = this.appBoxIter.getPrevVisible(this._previousSelectedActor);
                            this._previousVisibleIndex = this.appBoxIter.getVisibleIndex(item_actor);
                            this._scrollToButton(item_actor._delegate);
                            break;
                        case "down":
                            this._previousSelectedActor = this.applicationsBox.get_child_at_index(index);
                            item_actor = this.appBoxIter.getNextVisible(this._previousSelectedActor);
                            this._previousVisibleIndex = this.appBoxIter.getVisibleIndex(item_actor);
                            this._scrollToButton(item_actor._delegate);
                            break;
                        case "right":
                            this._previousSelectedActor = this.applicationsBox.get_child_at_index(index);
                            item_actor = (this._previousTreeSelectedActor != null) ?
                                this._previousTreeSelectedActor :
                                this.catBoxIter.getFirstVisible();
                            this._previousTreeSelectedActor = item_actor;
                            index = item_actor.get_parent()._vis_iter.getAbsoluteIndexOfChild(item_actor);

                            if (this.favBoxShow) {
                                item_actor._delegate.emit('enter-event');
                                this._previousSelectedActor = this.categoriesBox.get_child_at_index(index);
                                item_actor = this.favBoxIter.getFirstVisible();
                            }
                            break;
                        case "left":
                            this._previousSelectedActor = this.applicationsBox.get_child_at_index(index);
                            item_actor = (this._previousTreeSelectedActor != null) ?
                                this._previousTreeSelectedActor :
                                this.catBoxIter.getFirstVisible();
                            this._previousTreeSelectedActor = item_actor;
                            break;
                        case "top":
                            item_actor = this.appBoxIter.getFirstVisible();
                            this._previousVisibleIndex = this.appBoxIter.getVisibleIndex(item_actor);
                            this._scrollToButton(item_actor._delegate);
                            break;
                        case "bottom":
                            item_actor = this.appBoxIter.getLastVisible();
                            this._previousVisibleIndex = this.appBoxIter.getVisibleIndex(item_actor);
                            this._scrollToButton(item_actor._delegate);
                            break;
                    }
                    break;
                case this.favoritesBox:
                    switch (whichWay) {
                        case "up":
                            this._previousSelectedActor = this.favoritesBox.get_child_at_index(index);
                            if (this._previousSelectedActor === this.favBoxIter.getFirstVisible()) {
                                item_actor = this.sysBoxIter.getLastVisible();
                            } else {
                                item_actor = this.favBoxIter.getPrevVisible(this._previousSelectedActor);
                                this._scrollToButton(item_actor._delegate, this.favoritesScrollBox);
                            }
                            break;
                        case "down":
                            this._previousSelectedActor = this.favoritesBox.get_child_at_index(index);
                            if (this._previousSelectedActor === this.favBoxIter.getLastVisible()) {
                                item_actor = this.sysBoxIter.getFirstVisible();
                            } else {
                                item_actor = this.favBoxIter.getNextVisible(this._previousSelectedActor);
                                this._scrollToButton(item_actor._delegate, this.favoritesScrollBox);
                            }
                            break;
                        case "right":
                            item_actor = (this._previousTreeSelectedActor != null) ?
                                this._previousTreeSelectedActor :
                                this.catBoxIter.getFirstVisible();
                            this._previousTreeSelectedActor = item_actor;
                            break;
                        case "left":
                            item_actor = (this._previousTreeSelectedActor != null) ?
                                this._previousTreeSelectedActor :
                                this.catBoxIter.getFirstVisible();
                            this._previousTreeSelectedActor = item_actor;
                            index = item_actor.get_parent()._vis_iter.getAbsoluteIndexOfChild(item_actor);

                            item_actor._delegate.emit('enter-event');
                            item_actor = (this._previousVisibleIndex != null) ?
                                this.appBoxIter.getVisibleItem(this._previousVisibleIndex) :
                                this.appBoxIter.getFirstVisible();
                            break;
                        case "top":
                            item_actor = this.favBoxIter.getFirstVisible();
                            break;
                        case "bottom":
                            item_actor = this.favBoxIter.getLastVisible();
                            break;
                    }
                    break;
                case this.systemButtonsBox:
                    switch (whichWay) {
                        case "up":
                            this._previousSelectedActor = this.systemButtonsBox.get_child_at_index(index);
                            if (this._previousSelectedActor === this.sysBoxIter.getFirstVisible()) {
                                item_actor = this.favBoxIter.getLastVisible();
                                this._scrollToButton(item_actor._delegate, this.favoritesScrollBox);
                            } else {
                                item_actor = this.sysBoxIter.getPrevVisible(this._previousSelectedActor);
                            }
                            break;
                        case "down":
                            this._previousSelectedActor = this.systemButtonsBox.get_child_at_index(index);
                            if (this._previousSelectedActor === this.sysBoxIter.getLastVisible()) {
                                item_actor = this.favBoxIter.getFirstVisible();
                                this._scrollToButton(item_actor._delegate, this.favoritesScrollBox);
                            } else {
                                item_actor = this.sysBoxIter.getNextVisible(this._previousSelectedActor);
                            }
                            break;
                        case "right":
                            item_actor = (this._previousTreeSelectedActor != null) ?
                                this._previousTreeSelectedActor :
                                this.catBoxIter.getFirstVisible();
                            this._previousTreeSelectedActor = item_actor;
                            break;
                        case "left":
                            item_actor = (this._previousTreeSelectedActor != null) ?
                                this._previousTreeSelectedActor :
                                this.catBoxIter.getFirstVisible();
                            this._previousTreeSelectedActor = item_actor;
                            index = item_actor.get_parent()._vis_iter.getAbsoluteIndexOfChild(item_actor);

                            item_actor._delegate.emit('enter-event');
                            item_actor = (this._previousVisibleIndex != null) ?
                                this.appBoxIter.getVisibleItem(this._previousVisibleIndex) :
                                this.appBoxIter.getFirstVisible();
                            break;
                        case "top":
                            item_actor = this.systemButtonsBox.getFirstVisible();
                            break;
                        case "bottom":
                            item_actor = this.systemButtonsBox.getLastVisible();
                            break;
                    }
                    break;
                default:
                    break;
            }
            if (!item_actor)
                return false;
            index = item_actor.get_parent()._vis_iter.getAbsoluteIndexOfChild(item_actor);
        } else {
            if ((this._activeContainer && this._activeContainer !== this.categoriesBox) && (symbol === Clutter.KEY_Return || symbol === Clutter.KP_Enter)) {
                if (!ctrlKey) {
                    item_actor = this._activeContainer.get_child_at_index(this._selectedItemIndex);
                    item_actor._delegate.activate();
                } else if (ctrlKey && this._activeContainer === this.applicationsBox) {
                    item_actor = this.applicationsBox.get_child_at_index(this._selectedItemIndex);
                    if (item_actor._delegate instanceof ApplicationButton || item_actor._delegate instanceof RecentButton)
                        item_actor._delegate.activateContextMenus();
                }
                return true;
            } else if (this._activeContainer === this.applicationsBox && symbol === Clutter.KEY_Menu) {
                item_actor = this.applicationsBox.get_child_at_index(this._selectedItemIndex);
                if (item_actor._delegate instanceof ApplicationButton || item_actor._delegate instanceof RecentButton)
                    item_actor._delegate.activateContextMenus();
                return true;
            } else if (!this.searchActive && this._activeContainer === this.favoritesBox && symbol === Clutter.Delete) {
                item_actor = this.favoritesBox.get_child_at_index(this._selectedItemIndex);
                if (item_actor._delegate instanceof FavoritesButton) {
                    let favorites = AppFavorites.getAppFavorites().getFavorites();
                    let numFavorites = favorites.length;
                    AppFavorites.getAppFavorites().removeFavorite(item_actor._delegate.app.get_id());
                    item_actor._delegate.toggleMenu();
                    if (this._selectedItemIndex == (numFavorites-1))
                        item_actor = this.favoritesBox.get_child_at_index(this._selectedItemIndex-1);
                    else
                        item_actor = this.favoritesBox.get_child_at_index(this._selectedItemIndex);
                }
            } else if (this._activeContainer === this.favoritesBox &&
                        (symbol === Clutter.KEY_Down || symbol === Clutter.KEY_Up) && ctrlKey &&
                        (this.favoritesBox.get_child_at_index(index))._delegate instanceof FavoritesButton) {
                item_actor = this.favoritesBox.get_child_at_index(this._selectedItemIndex);
                let id = item_actor._delegate.app.get_id();
                let appFavorites = AppFavorites.getAppFavorites();
                let favorites = appFavorites.getFavorites();
                let numFavorites = favorites.length;
                let favPos = 0;
                if (this._selectedItemIndex == (numFavorites-1) && symbol === Clutter.KEY_Down)
                    favPos = 0;
                else if (this._selectedItemIndex == 0 && symbol === Clutter.KEY_Up)
                    favPos = numFavorites-1;
                else if (symbol === Clutter.KEY_Down)
                    favPos = this._selectedItemIndex + 1;
                else
                    favPos = this._selectedItemIndex - 1;
                appFavorites.moveFavoriteToPos(id, favPos);
                item_actor = this.favoritesBox.get_child_at_index(favPos);
                this._scrollToButton(item_actor._delegate, this.favoritesScrollBox);
            } else if (this.searchFilesystem && (this._fileFolderAccessActive || symbol === Clutter.slash)) {
                if (symbol === Clutter.Return || symbol === Clutter.KP_Enter) {
                    if (this._run(this.searchEntry.get_text())) {
                        this.menu.close();
                    }
                    return true;
                }
                if (symbol === Clutter.Escape) {
                    this.searchEntry.set_text('');
                    this._fileFolderAccessActive = false;
                }
                if (symbol === Clutter.slash) {
                    // Need preload data before get completion. GFilenameCompleter load content of parent directory.
                    // Parent directory for /usr/include/ is /usr/. So need to add fake name('a').
                    let text = this.searchEntry.get_text().concat('/a');
                    let prefix;
                    if (text.lastIndexOf(' ') == -1)
                        prefix = text;
                    else
                        prefix = text.substr(text.lastIndexOf(' ') + 1);
                    this._getCompletion(prefix);

                    return false;
                }
                if (symbol === Clutter.Tab) {
                    let text = actor.get_text();
                    let prefix;
                    if (text.lastIndexOf(' ') == -1)
                        prefix = text;
                    else
                        prefix = text.substr(text.lastIndexOf(' ') + 1);
                    let postfix = this._getCompletion(prefix);
                    if (postfix != null && postfix.length > 0) {
                        actor.insert_text(postfix, -1);
                        actor.set_cursor_position(text.length + postfix.length);
                        if (postfix[postfix.length - 1] == '/')
                            this._getCompletion(text + postfix + 'a');
                    }
                    return true;
                }
                if (symbol === Clutter.ISO_Left_Tab) {
                    return true;
                }
                return false;
            } else if (symbol === Clutter.Tab || symbol === Clutter.ISO_Left_Tab) {
                return true;
            } else {
                return false;
            }
        }

        this.selectedAppTitle.set_text("");
        this.selectedAppDescription.set_text("");

        this._selectedItemIndex = index;
        if (!item_actor || item_actor === this.searchEntry) {
            return false;
        }
        item_actor._delegate.emit('enter-event');
        return true;
    }

    _addEnterEvent(button, callback) {
        let _callback = Lang.bind(this, function() {
            let parent = button.actor.get_parent();
            if (this._activeContainer === this.categoriesBox && parent !== this._activeContainer) {
                this._previousTreeSelectedActor = this._activeActor;
                this._previousSelectedActor = null;
            }
            if (this._previousTreeSelectedActor && this._activeContainer !== this.categoriesBox &&
                    parent !== this._activeContainer && button !== this._previousTreeSelectedActor && !this.searchActive) {
                this._previousTreeSelectedActor.style_class = "menu-category-button";
            }
            if (parent != this._activeContainer && parent._vis_iter) {
                parent._vis_iter.reloadVisible();
            }
            let _maybePreviousActor = this._activeActor;
            if (_maybePreviousActor && this._activeContainer !== this.categoriesBox) {
                this._previousSelectedActor = _maybePreviousActor;
                this._clearPrevSelection();
            }
            if (parent === this.categoriesBox && !this.searchActive) {
                this._previousSelectedActor = _maybePreviousActor;
                this._clearPrevCatSelection();
            }
            this._activeContainer = parent;
            this._activeActor = button.actor;

            if (this._activeContainer._vis_iter) {
                this._selectedItemIndex = this._activeContainer._vis_iter.getAbsoluteIndexOfChild(this._activeActor);
            }

            callback();
        });
        button.connect('enter-event', _callback);
        button.actor.connect('enter-event', _callback);
    }

    _clearPrevSelection(actor) {
        if (this._previousSelectedActor
            && !this._previousSelectedActor.is_finalized()
            && this._previousSelectedActor != actor) {
            if (this._previousSelectedActor._delegate instanceof ApplicationButton ||
                this._previousSelectedActor._delegate instanceof RecentButton ||
                this._previousSelectedActor._delegate instanceof SearchProviderResultButton ||
                this._previousSelectedActor._delegate instanceof PlaceButton ||
                this._previousSelectedActor._delegate instanceof RecentClearButton ||
                this._previousSelectedActor._delegate instanceof TransientButton)
                this._previousSelectedActor.style_class = "menu-application-button";
            else if (this._previousSelectedActor._delegate instanceof FavoritesButton ||
                     this._previousSelectedActor._delegate instanceof SystemButton)
                this._previousSelectedActor.remove_style_pseudo_class("hover");
        }
    }

    _clearPrevCatSelection(actor) {
        if (this._previousTreeSelectedActor && this._previousTreeSelectedActor != actor) {
            this._previousTreeSelectedActor.style_class = "menu-category-button";

            if (this._previousTreeSelectedActor._delegate) {
                this._previousTreeSelectedActor._delegate.emit('leave-event');
            }

            if (actor !== undefined) {
                this._previousVisibleIndex = null;
                this._previousTreeSelectedActor = actor;
            }
        } else {
            this.categoriesBox.get_children().forEach(child => child.style_class = "menu-category-button");
        }
    }

    /*
     * The vectorBox overlays the the categoriesBox to aid in navigation from categories to apps
     * by preventing misselections. It is set to the same size as the categoriesOverlayBox and
     * categoriesBox.
     *
     * The actor is a quadrilateral that we turn into a triangle by setting the A and B vertices to
     * the same position. The size and origin of the vectorBox are calculated in _getVectorInfo().
     * Using those properties, the bounding box is sized as (w, h) and the triangle is defined as
     * follows:
     *   _____
     *  |    /|D
     *  |   / |     AB: (mx, my)
     *  | A/  |      C: (w, h)
     *  | B\  |      D: (w, 0)
     *  |   \ |
     *  |____\|C
     */

    _getVectorInfo() {
        let [mx, my, mask] = global.get_pointer();
        let [bx, by] = this.categoriesOverlayBox.get_transformed_position();
        let [bw, bh] = this.categoriesOverlayBox.get_transformed_size();

        let xformed_mx = mx - bx;
        let xformed_my = my - by;

        if (xformed_mx < 0 || xformed_mx > bw || xformed_my < 0 || xformed_my > bh) {
            return null;
        }

        return { mx: xformed_mx,
                 my: xformed_my,
                 w: bw,
                 h: bh };
    }

    makeVectorBox(actor) {
        this.destroyVectorBox(actor);
        let vi = this._getVectorInfo();
        if (!vi) {
            return;
        }

        this.vectorBox = new St.Polygon({ debug: false, width: vi.w -1, height: vi.h,
                                          ulc_x: vi.mx, ulc_y: vi.my,
                                          llc_x: vi.mx, llc_y: vi.my,
                                          urc_x: vi.w, urc_y: 0,
                                          lrc_x: vi.w, lrc_y: vi.h });

        this.categoriesOverlayBox.add_actor(this.vectorBox);

        this.vectorBox.show();
        this.vectorBox.set_reactive(true);

        this.vectorBox.connect("leave-event", Lang.bind(this, this.destroyVectorBox));
        this.vectorBox.connect("motion-event", Lang.bind(this, this.maybeUpdateVectorBox));
        this.actor_motion_id = actor.connect("motion-event", Lang.bind(this, this.maybeUpdateVectorBox));
        this.current_motion_actor = actor;
    }

    maybeUpdateVectorBox() {
        if (this.vector_update_loop) {
            Mainloop.source_remove(this.vector_update_loop);
            this.vector_update_loop = 0;
        }
        this.vector_update_loop = Mainloop.timeout_add(50, Lang.bind(this, this.updateVectorBox));
    }

    updateVectorBox(actor) {
        if (this.vectorBox) {
            let vi = this._getVectorInfo();
            if (vi) {
                this.vectorBox.ulc_x = vi.mx;
                this.vectorBox.llc_x = vi.mx;
                this.vectorBox.queue_repaint();
            } else {
                this.destroyVectorBox(actor);
            }
        }
        this.vector_update_loop = 0;
        return false;
    }

    destroyVectorBox(actor) {
        if (this.vectorBox != null) {
            this.vectorBox.destroy();
            this.vectorBox = null;
        }
        if (this.actor_motion_id > 0 && this.current_motion_actor != null) {
            this.current_motion_actor.disconnect(this.actor_motion_id);
            this.actor_motion_id = 0;
            this.current_motion_actor = null;
        }
    }

    _refreshPlaces () {
        for (let i = 0; i < this._placesButtons.length; i ++) {
            this._placesButtons[i].actor.destroy();
        }

        this._placesButtons = [];

        for (let i = 0; i < this._categoryButtons.length; i++) {
            if (this._categoryButtons[i] instanceof PlaceCategoryButton) {
                this._categoryButtons[i].destroy();
                this._categoryButtons.splice(i, 1);
                this.placesButton = null;
                break;
            }
        }

        // Now generate Places category and places buttons and add to the list
        if (this.showPlaces) {
            this.placesButton = new PlaceCategoryButton(null, this.showCategoryIcons);
            this._addEnterEvent(this.placesButton, Lang.bind(this, function() {
                if (!this.searchActive) {
                    this.placesButton.isHovered = true;

                    this._clearPrevCatSelection(this.placesButton.actor);
                    this.placesButton.actor.style_class = "menu-category-button-selected";
                    this.closeContextMenus(null, false);
                    this._select_category("places");

                    this.makeVectorBox(this.placesButton.actor);
                }
            }));
            this.placesButton.actor.connect('leave-event', Lang.bind(this, function () {
                if (this._previousTreeSelectedActor === null) {
                    this._previousTreeSelectedActor = this.placesButton.actor;
                } else {
                    let prevIdx = this.catBoxIter.getVisibleIndex(this._previousTreeSelectedActor);
                    let nextIdx = this.catBoxIter.getVisibleIndex(this.placesButton.actor);

                    if (Math.abs(prevIdx - nextIdx) <= 1) {
                        this._previousTreeSelectedActor = this.placesButton.actor;
                    }
                }

                this.placesButton.isHovered = false;
            }));
            this._categoryButtons.push(this.placesButton);
            this.categoriesBox.add_actor(this.placesButton.actor);

            let bookmarks = this._listBookmarks()[0];
            let devices = this._listDevices()[0];
            let places = bookmarks.concat(devices);

            let handleEnterEvent = (button) => {
                this._addEnterEvent(button, () => {
                    this._clearPrevSelection(button.actor);
                    button.actor.style_class = "menu-application-button-selected";
                    this.selectedAppTitle.set_text("");
                    let selectedAppId = button.place.idDecoded;
                    selectedAppId = selectedAppId.substr(selectedAppId.indexOf(':') + 1);
                    let fileIndex = selectedAppId.indexOf('file:///');
                    if (fileIndex !== -1)
                        selectedAppId = selectedAppId.substr(fileIndex + 7);
                    this.selectedAppDescription.set_text(selectedAppId);
                });
            };

            let handleLeaveEvent = (button) => {
                button.actor.connect('leave-event', () => {
                    this._previousSelectedActor = button.actor;
                    this.selectedAppTitle.set_text("");
                    this.selectedAppDescription.set_text("");
                });
            };

            for (let i = 0; i < places.length; i++) {
                let place = places[i];
                let button = new PlaceButton(this, place, place.name, this.showApplicationIcons);
                handleEnterEvent(button);
                handleLeaveEvent(button);
                this._placesButtons.push(button);
                this.applicationsBox.add_actor(button.actor);
            }
        }

        this._setCategoriesButtonActive(!this.searchActive);

        this._resizeApplicationsBox();
    }

    _refreshRecent () {

        for (let i = 0; i < this._recentButtons.length; i ++) {
            this._recentButtons[i].destroy();
        }

        this._recentButtons = [];

        if (this.privacy_settings.get_boolean(REMEMBER_RECENT_KEY)) {
            if (this.recentButton == null) {
                this.recentButton = new RecentCategoryButton(null, this.showCategoryIcons);
                this._addEnterEvent(this.recentButton, Lang.bind(this, function() {
                    if (!this.searchActive) {
                        this.recentButton.isHovered = true;

                        this._clearPrevCatSelection(this.recentButton.actor);
                        this.recentButton.actor.style_class = "menu-category-button-selected";
                        this.closeContextMenus(null, false);
                        this._select_category("recent");

                        this.makeVectorBox(this.recentButton.actor);
                    }
                }));
                this.recentButton.actor.connect('leave-event', Lang.bind(this, function () {

                    if (this._previousTreeSelectedActor === null) {
                        this._previousTreeSelectedActor = this.recentButton.actor;
                    } else {
                        let prevIdx = this.catBoxIter.getVisibleIndex(this._previousTreeSelectedActor);
                        let nextIdx = this.catBoxIter.getVisibleIndex(this.recentButton.actor);

                        if (Math.abs(prevIdx - nextIdx) <= 1) {
                            this._previousTreeSelectedActor = this.recentButton.actor;
                        }
                    }

                    this.recentButton.isHovered = false;
                }));

                this._categoryButtons.push(this.recentButton);
            }

            /* Make sure the recent category is at the bottom (can happen when refreshing places
             * or apps, since we don't destroy the recent category button each time we refresh recents,
             * as it happens a lot) */

            let parent = this.recentButton.actor.get_parent();

            if (parent != null) {
                parent.remove_child(this.recentButton.actor);
            }

            this.categoriesBox.add_actor(this.recentButton.actor);
            this._categoryButtons.splice(this._categoryButtons.indexOf(this.recentButton), 1);
            this._categoryButtons.push(this.recentButton);

            if (this.RecentManager._infosByTimestamp.length > 0) {
                let id = 0;
                while (id < this.RecentManager._infosByTimestamp.length) {
                    let new_button = new RecentButton(this, this.RecentManager._infosByTimestamp[id], this.showApplicationIcons);
                    this._addEnterEvent(new_button, () => {
                        this._clearPrevSelection(new_button.actor);
                        new_button.actor.style_class = "menu-application-button-selected";
                        this.selectedAppTitle.set_text("");
                        let selectedAppUri = new_button.uriDecoded;
                        let fileIndex = selectedAppUri.indexOf("file:///");
                        if (fileIndex !== -1)
                            selectedAppUri = selectedAppUri.substr(fileIndex + 7);
                        this.selectedAppDescription.set_text(selectedAppUri);
                    });
                    new_button.actor.connect('leave-event', () => {
                        new_button.actor.style_class = "menu-application-button";
                        this._previousSelectedActor = new_button.actor;
                        this.selectedAppTitle.set_text("");
                        this.selectedAppDescription.set_text("");
                    });
                    this._recentButtons.push(new_button);
                    this.applicationsBox.add_child(new_button.actor);
                    id++;
                }
                let recent_clear_button = new RecentClearButton(this);
                this._addEnterEvent(recent_clear_button, Lang.bind(this, function() {
                    this._clearPrevSelection(recent_clear_button.actor);
                    recent_clear_button.actor.style_class = "menu-application-button-selected";
                }));
                recent_clear_button.actor.connect('leave-event', Lang.bind(this, function() {
                    recent_clear_button.actor.style_class = "menu-application-button";
                    this._previousSelectedActor = recent_clear_button.actor;
                }));
                this._recentButtons.push(recent_clear_button);
                this.applicationsBox.add_child(recent_clear_button.actor);
            } else {
                let no_recent_button = new NoRecentDocsButton(_("No recent documents"), null, false, null);
                this._recentButtons.push(no_recent_button);
                this.applicationsBox.add_child(no_recent_button.actor);
            }
        } else {
            for (let i = 0; i < this._categoryButtons.length; i++) {
                if (this._categoryButtons[i] instanceof RecentCategoryButton) {
                    this._categoryButtons[i].destroy();
                    this._categoryButtons.splice(i, 1);
                    this.recentButton = null;
                    break;
                }
            }
        }

        this._setCategoriesButtonActive(!this.searchActive);

        this._resizeApplicationsBox();
    }

    _refreshApps () {
        /* iterate in reverse, so multiple splices will not upset
         * the remaining elements */
        for (let i = this._categoryButtons.length - 1; i > -1; i--) {
            if (this._categoryButtons[i] instanceof CategoryButton) {
                this._categoryButtons[i].destroy();
                this._categoryButtons.splice(i, 1);
            }
        }

        this._applicationsButtons.forEach(button => button.destroy());

        this._applicationsButtons = [];
        // this.applicationsBox.destroy_all_children();

        this._transientButtons = [];
        this._applicationsButtonFromApp = {};
        this._applicationsBoxWidth = 0;

        this._allAppsCategoryButton = new CategoryButton(null);
        this._addEnterEvent(this._allAppsCategoryButton, Lang.bind(this, function() {
            if (!this.searchActive) {
                this._allAppsCategoryButton.isHovered = true;

                this._clearPrevCatSelection(this._allAppsCategoryButton.actor);
                this._allAppsCategoryButton.actor.style_class = "menu-category-button-selected";
                this._select_category(null);

                this.makeVectorBox(this._allAppsCategoryButton.actor);
            }
        }));
        this._allAppsCategoryButton.actor.connect('leave-event', Lang.bind(this, function () {
            this._previousSelectedActor = this._allAppsCategoryButton.actor;
            this._allAppsCategoryButton.isHovered = false;
        }));

        this.categoriesBox.add_actor(this._allAppsCategoryButton.actor);
        this._categoryButtons.push(this._allAppsCategoryButton);

        let tree = new CMenu.Tree({ menu_basename: "cinnamon-applications.menu" });
        tree.load_sync();
        let root = tree.get_root_directory();
        let dirs = [];
        let iter = root.iter();
        let nextType;

        while ((nextType = iter.next()) != CMenu.TreeItemType.INVALID) {
            if (nextType == CMenu.TreeItemType.DIRECTORY) {
                dirs.push(iter.get_directory());
            }
        }

        let prefCats = ["administration", "preferences"];

        let sortDirs = function(a, b) {
            let menuIdA = a.get_menu_id().toLowerCase();
            let menuIdB = b.get_menu_id().toLowerCase();

            let prefIdA = prefCats.indexOf(menuIdA);
            let prefIdB = prefCats.indexOf(menuIdB);

            if (prefIdA < 0 && prefIdB >= 0) {
                return -1;
            }
            if (prefIdA >= 0 && prefIdB < 0) {
                return 1;
            }

            let nameA = a.get_name().toLowerCase();
            let nameB = b.get_name().toLowerCase();

            if (nameA > nameB) {
                return 1;
            }
            if (nameA < nameB) {
                return -1;
            }
            return 0;
        };

        dirs = dirs.sort(sortDirs);

        let handleEnterEvent = (categoryButton, dir) => {
            this._addEnterEvent(categoryButton, () => {
                if (!this.searchActive) {
                    categoryButton.isHovered = true;

                    this._clearPrevCatSelection(categoryButton.actor);
                    categoryButton.actor.style_class = "menu-category-button-selected";
                    this._select_category(dir.get_menu_id());

                    this.makeVectorBox(categoryButton.actor);
                }
            });
        };

        let handleLeaveEvent = (categoryButton, dir) => {
            categoryButton.actor.connect('leave-event', () => {
                if (this._previousTreeSelectedActor === null) {
                    this._previousTreeSelectedActor = categoryButton.actor;
                } else {
                    let prevIdx = this.catBoxIter.getVisibleIndex(this._previousTreeSelectedActor);
                    let nextIdx = this.catBoxIter.getVisibleIndex(categoryButton.actor);
                    if (Math.abs(prevIdx - nextIdx) <= 1) {
                        this._previousTreeSelectedActor = categoryButton.actor;
                    }
                }
                categoryButton.isHovered = false;
            });
        };

        for (let i = 0; i < dirs.length; i++) {
            let dir = dirs[i];
            if (dir.get_is_nodisplay())
                continue;
            if (this._loadCategory(dir)) {
                let categoryButton = new CategoryButton(dir, this.showCategoryIcons);
                handleEnterEvent(categoryButton, dir);
                handleLeaveEvent(categoryButton, dir);

                this._categoryButtons.push(categoryButton);
                this.categoriesBox.add_actor(categoryButton.actor);
            }
        }

        // Sort apps and add to applicationsBox
        this._applicationsButtons.sort(function(a, b) {
            a = Util.latinise(a.app.get_name().toLowerCase());
            b = Util.latinise(b.app.get_name().toLowerCase());
            return a > b;
        });

        for (let i = 0; i < this._applicationsButtons.length; i++) {
            this.applicationsBox.add_actor(this._applicationsButtons[i].actor);
            this.applicationsBox.add_actor(this._applicationsButtons[i].menu.actor);
        }

        this._appsWereRefreshed = true;
    }

    _favEnterEvent (button) {
        button.actor.add_style_pseudo_class("hover");
        if (button instanceof FavoritesButton) {
            this.selectedAppTitle.set_text(button.app.get_name());
            if (button.app.get_description())
                this.selectedAppDescription.set_text(button.app.get_description().split("\n")[0]);
            else
                this.selectedAppDescription.set_text("");
        } else {
            this.selectedAppTitle.set_text(button.name);
            this.selectedAppDescription.set_text(button.desc);
        }
    }

    _favLeaveEvent (widget, event, button) {
        this._previousSelectedActor = button.actor;
        button.actor.remove_style_pseudo_class("hover");
        this.selectedAppTitle.set_text("");
        this.selectedAppDescription.set_text("");
    }

    _refreshFavs() {
        //Remove all favorites
        this.favoritesBox.destroy_all_children();

        //Load favorites again
        this._favoritesButtons = [];
        let launchers = global.settings.get_strv('favorite-apps');
        let appSys = Cinnamon.AppSystem.get_default();
        for ( let i = 0; i < launchers.length; ++i ) {
            let app = appSys.lookup_app(launchers[i]);
            if (app) {
                let button = new FavoritesButton(this, app, launchers.length + 3); // + 3 because we're adding 3 system buttons at the bottom
                this._favoritesButtons[app] = button;
                this.favoritesBox.add(button.actor, { y_align: St.Align.END, y_fill: false });

                this._addEnterEvent(button, Lang.bind(this, this._favEnterEvent, button));
                button.actor.connect('leave-event', Lang.bind(this, this._favLeaveEvent, button));
            }
        }
    }

    _refreshSystemButtons() {
        // Remove all system buttons
        this.systemButtonsBox.destroy_all_children();

        // Load system buttons again
        let launchers = global.settings.get_strv('favorite-apps');
        let button;

        //Lock screen
        button = new SystemButton("system-lock-screen", launchers.length + 3,
                                      _("Lock screen"),
                                      _("Lock the screen"));

        this._addEnterEvent(button, Lang.bind(this, this._favEnterEvent, button));
        button.actor.connect('leave-event', Lang.bind(this, this._favLeaveEvent, button));

        button.activate = () => {
            this.menu.close();

            let screensaver_settings = new Gio.Settings({ schema_id: "org.cinnamon.desktop.screensaver" });
            let screensaver_dialog = Gio.file_new_for_path("/usr/bin/cinnamon-screensaver-command");
            if (screensaver_dialog.query_exists(null)) {
                if (screensaver_settings.get_boolean("ask-for-away-message")) {
                    Util.spawnCommandLine("cinnamon-screensaver-lock-dialog");
                }
                else {
                    Util.spawnCommandLine("cinnamon-screensaver-command --lock");
                }
            }
            else {
                this._screenSaverProxy.LockRemote("");
            }
        };

        this.systemButtonsBox.add(button.actor, { y_align: St.Align.END, y_fill: false });

        //Logout button
        button = new SystemButton("system-log-out", launchers.length + 3,
                                      _("Logout"),
                                      _("Leave the session"));

        this._addEnterEvent(button, Lang.bind(this, this._favEnterEvent, button));
        button.actor.connect('leave-event', Lang.bind(this, this._favLeaveEvent, button));

        button.activate = () => {
            this.menu.close();
            this._session.LogoutRemote(0);
        };

        this.systemButtonsBox.add(button.actor, { y_align: St.Align.END, y_fill: false });

        //Shutdown button
        button = new SystemButton("system-shutdown", launchers.length + 3,
                                      _("Quit"),
                                      _("Shutdown the computer"));

        this._addEnterEvent(button, Lang.bind(this, this._favEnterEvent, button));
        button.actor.connect('leave-event', Lang.bind(this, this._favLeaveEvent, button));

        button.activate = () => {
            this.menu.close();
            this._session.ShutdownRemote();
        };

        this.systemButtonsBox.add(button.actor, { y_align: St.Align.END, y_fill: false });
    }

    _loadCategory(dir, top_dir) {
        let iter = dir.iter();
        let has_entries = false;
        let nextType;
        if (!top_dir) top_dir = dir;
        while ((nextType = iter.next()) != CMenu.TreeItemType.INVALID) {
            if (nextType == CMenu.TreeItemType.ENTRY) {
                let entry = iter.get_entry();
                let appInfo = entry.get_app_info();
                if (appInfo && appInfo.should_show() && !appInfo.get_nodisplay()) {
                    has_entries = true;
                    let app = appsys.lookup_app(entry.get_desktop_file_id());
                    let app_key = app.get_id();
                    if (app_key == null) {
                        app_key = app.get_name() + ":" +
                            app.get_description();
                    }
                    if (!(app_key in this._applicationsButtonFromApp)) {

                        let applicationButton = new ApplicationButton(this, app, this.showApplicationIcons);

                        if (!this._knownApps.has(app_key)) {
                            if (this._appsWereRefreshed) {
                                applicationButton.highlight();
                            } else {
                                this._knownApps.add(app_key);
                            }
                        }

                        applicationButton.actor.connect('leave-event', Lang.bind(this, this._appLeaveEvent, applicationButton));
                        this._addEnterEvent(applicationButton, Lang.bind(this, this._appEnterEvent, applicationButton));
                        this._applicationsButtons.push(applicationButton);
                        applicationButton.category.push(top_dir.get_menu_id());
                        this._applicationsButtonFromApp[app_key] = applicationButton;
                    } else {
                        this._applicationsButtonFromApp[app_key].category.push(dir.get_menu_id());
                    }
                }
            } else if (nextType == CMenu.TreeItemType.DIRECTORY) {
                let subdir = iter.get_directory();
                if (this._loadCategory(subdir, top_dir)) {
                    has_entries = true;
                }
            }
        }
        return has_entries;
    }

    _appLeaveEvent(a, b, applicationButton) {
        this._previousSelectedActor = applicationButton.actor;
        applicationButton.actor.style_class = "menu-application-button";
        this.selectedAppTitle.set_text("");
        this.selectedAppDescription.set_text("");
    }

    _appEnterEvent(applicationButton) {
        this.selectedAppTitle.set_text(applicationButton.app.get_name());
        if (applicationButton.app.get_description())
            this.selectedAppDescription.set_text(applicationButton.app.get_description());
        else
            this.selectedAppDescription.set_text("");
        this._previousVisibleIndex = this.appBoxIter.getVisibleIndex(applicationButton.actor);
        this._clearPrevSelection(applicationButton.actor);
        applicationButton.actor.style_class = "menu-application-button-selected";
    }

    _scrollToButton(button, scrollBox = null) {
        if (!scrollBox) scrollBox = this.applicationsScrollBox;

        let current_scroll_value = scrollBox.get_vscroll_bar().get_adjustment().get_value();
        let box_height = scrollBox.get_allocation_box().y2 - scrollBox.get_allocation_box().y1;
        let new_scroll_value = current_scroll_value;

        if (current_scroll_value > button.actor.get_allocation_box().y1 - 10) new_scroll_value = button.actor.get_allocation_box().y1 - 10;
        if (box_height + current_scroll_value < button.actor.get_allocation_box().y2 + 10) new_scroll_value = button.actor.get_allocation_box().y2-box_height + 10;
        if (new_scroll_value != current_scroll_value) scrollBox.get_vscroll_bar().get_adjustment().set_value(new_scroll_value);
    }

    _display() {
        this._activeContainer = null;
        this._activeActor = null;
        this.vectorBox = null;
        this.actor_motion_id = 0;
        this.vector_update_loop = null;
        this.current_motion_actor = null;
        let section = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(section);

        this.leftPane = new St.BoxLayout({ vertical: true });

        this.leftBox = new St.BoxLayout({ style_class: 'menu-favorites-box', vertical: true });

        this._session = new GnomeSession.SessionManager();
        this._screenSaverProxy = new ScreenSaver.ScreenSaverProxy();

        this.leftPane.add(this.leftBox, { y_align: St.Align.END, y_fill: false });
        this._favboxtoggle();

        let rightPane = new St.BoxLayout({ vertical: true });

        this.searchBox = new St.BoxLayout({ style_class: 'menu-search-box' });

        this.searchEntry = new St.Entry({ name: 'menu-search-entry',
                                     hint_text: _("Type to search..."),
                                     track_hover: true,
                                     can_focus: true });
        this.searchEntry.set_secondary_icon(this._searchInactiveIcon);
        this.searchBox.add(this.searchEntry, {x_fill: true, x_align: St.Align.START, y_align: St.Align.MIDDLE, y_fill: false, expand: true});
        this.searchActive = false;
        this.searchEntryText = this.searchEntry.clutter_text;
        this.searchEntryText.connect('text-changed', Lang.bind(this, this._onSearchTextChanged));
        this.searchEntryText.connect('key-press-event', Lang.bind(this, this._onMenuKeyPress));
        this._previousSearchPattern = "";

        this.categoriesApplicationsBox = new CategoriesApplicationsBox();
        rightPane.add_actor(this.searchBox);
        rightPane.add_actor(this.categoriesApplicationsBox.actor);

        this.categoriesOverlayBox = new Clutter.Actor();
        this.categoriesBox = new St.BoxLayout({ style_class: 'menu-categories-box',
                                                vertical: true,
                                                accessible_role: Atk.Role.LIST });
        this.categoriesOverlayBox.add_actor(this.categoriesBox);

        this.applicationsScrollBox = new St.ScrollView({ x_fill: true, y_fill: false, y_align: St.Align.START, style_class: 'vfade menu-applications-scrollbox' });
        this.favoritesScrollBox = new St.ScrollView({
            x_fill: true,
            y_fill: false,
            y_align: St.Align.START,
            style_class: 'vfade menu-favorites-scrollbox'
        });

        this.a11y_settings = new Gio.Settings({ schema_id: "org.cinnamon.desktop.a11y.applications" });
        this.a11y_settings.connect("changed::screen-magnifier-enabled", Lang.bind(this, this._updateVFade));
        this.a11y_mag_settings = new Gio.Settings({ schema_id: "org.cinnamon.desktop.a11y.magnifier" });
        this.a11y_mag_settings.connect("changed::mag-factor", Lang.bind(this, this._updateVFade));

        this._updateVFade();

        this.settings.bind("enable-autoscroll", "autoscroll_enabled", this._update_autoscroll);
        this._update_autoscroll();

        let vscroll = this.applicationsScrollBox.get_vscroll_bar();
        vscroll.connect('scroll-start',
                        Lang.bind(this, function() {
                            this.menu.passEvents = true;
                        }));
        vscroll.connect('scroll-stop',
                        Lang.bind(this, function() {
                            this.menu.passEvents = false;
                        }));

        this.applicationsBox = new St.BoxLayout({ style_class: 'menu-applications-inner-box', vertical:true });
        this.applicationsBox.add_style_class_name('menu-applications-box'); //this is to support old themes
        this.applicationsScrollBox.add_actor(this.applicationsBox);
        this.applicationsScrollBox.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC);
        this.categoriesApplicationsBox.actor.add_actor(this.categoriesOverlayBox);
        this.categoriesApplicationsBox.actor.add_actor(this.applicationsScrollBox);

        this.favoritesBox = new FavoritesBox().actor;
        this.favoritesScrollBox.add_actor(this.favoritesBox);
        this.favoritesScrollBox.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.NEVER);

        this.leftBox.add(this.favoritesScrollBox, {
            y_align: St.Align.END,
            y_fill: false
        });

        this.systemButtonsBox = new St.BoxLayout({ vertical: true });
        this.leftBox.add(this.systemButtonsBox, { y_align: St.Align.END, y_fill: false });

        this.mainBox = new St.BoxLayout({ style_class: 'menu-applications-outer-box', vertical:false });
        this.mainBox.add_style_class_name('menu-applications-box'); //this is to support old themes

        this.mainBox.add(this.leftPane, { span: 1 });
        this.mainBox.add(rightPane, { span: 1 });
        this.mainBox._delegate = null;

        this.selectedAppBox = new St.BoxLayout({ style_class: 'menu-selected-app-box', vertical: true });

        if (this.selectedAppBox.peek_theme_node() == null ||
            this.selectedAppBox.get_theme_node().get_length('height') == 0)
            this.selectedAppBox.set_height(30 * global.ui_scale);

        this.selectedAppTitle = new St.Label({ style_class: 'menu-selected-app-title', text: "" });
        this.selectedAppBox.add_actor(this.selectedAppTitle);
        this.selectedAppDescription = new St.Label({ style_class: 'menu-selected-app-description', text: "" });
        this.selectedAppBox.add_actor(this.selectedAppDescription);
        this.selectedAppBox._delegate = null;

        section.actor.add(this.mainBox);
        section.actor.add_actor(this.selectedAppBox);

        this.appBoxIter = new VisibleChildIterator(this.applicationsBox);
        this.applicationsBox._vis_iter = this.appBoxIter;
        this.catBoxIter = new VisibleChildIterator(this.categoriesBox);
        this.categoriesBox._vis_iter = this.catBoxIter;
        this.favBoxIter = new VisibleChildIterator(this.favoritesBox);
        this.favoritesBox._vis_iter = this.favBoxIter;
        this.sysBoxIter = new VisibleChildIterator(this.systemButtonsBox);
        this.systemButtonsBox._vis_iter = this.sysBoxIter;

        Mainloop.idle_add(Lang.bind(this, function() {
            this._clearAllSelections(true);
        }));

        this.menu.actor.connect("allocation-changed", Lang.bind(this, this._on_allocation_changed));
    }

    _updateVFade() {
        let mag_on = this.a11y_settings.get_boolean("screen-magnifier-enabled") &&
                     this.a11y_mag_settings.get_double("mag-factor") > 1.0;
        if (mag_on) {
            this.applicationsScrollBox.style_class = "menu-applications-scrollbox";
            this.favoritesScrollBox.style_class = "menu-favorites-scrollbox";
        } else {
            this.applicationsScrollBox.style_class = "vfade menu-applications-scrollbox";
            this.favoritesScrollBox.style_class = "vfade menu-favorites-scrollbox";
        }
    }

    _update_autoscroll() {
        this.applicationsScrollBox.set_auto_scrolling(this.autoscroll_enabled);
        this.favoritesScrollBox.set_auto_scrolling(this.autoscroll_enabled);
    }

    _on_allocation_changed(box, flags, data) {
        this._recalc_height();
    }

    _clearAllSelections(hide_apps) {
        let actors = this.applicationsBox.get_children();
        for (let i = 0; i < actors.length; i++) {
            let actor = actors[i];
            actor.style_class = "menu-application-button";
            if (hide_apps) {
                actor.hide();
            }
        }
        actors = this.categoriesBox.get_children();
        for (let i = 0; i < actors.length; i++){
            let actor = actors[i];
            actor.style_class = "menu-category-button";
            actor.show();
        }
        actors = this.favoritesBox.get_children();
        for (let i = 0; i < actors.length; i++){
            let actor = actors[i];
            actor.remove_style_pseudo_class("hover");
            actor.show();
        }
        actors = this.systemButtonsBox.get_children();
        for (let i = 0; i < actors.length; i++){
            let actor = actors[i];
            actor.remove_style_pseudo_class("hover");
            actor.show();
        }
    }

    _select_category (name) {
        if (name === this.lastSelectedCategory) {
            return;
        }

        this.lastSelectedCategory = name;

        if (name === "places") {
            this._displayButtons(null, -1);
        } else if (name === "recent") {
            this._displayButtons(null, null, -1);
        } else if (name == null) {
            this._displayButtons(-1);
        } else {
            // category id
            this._displayButtons(name);
        }

        this.closeContextMenus(null, false);
    }

    closeContextMenus(excluded, animate) {
        for (let app in this._applicationsButtons){
            if (this._applicationsButtons[app] != excluded && this._applicationsButtons[app].menu.isOpen){
                if (animate)
                    this._applicationsButtons[app].toggleMenu();
                else
                    this._applicationsButtons[app].closeMenu();
            }
        }

        if (!this.recentContextMenu) {
            return;
        }

        let item = this.recentContextMenu.sourceActor._delegate;

        if ((item != excluded || excluded == null) && item.menu && item.menu.isOpen) {
            if (animate)
                this.recentContextMenu.toggle();
            else
                this.recentContextMenu.close();

            this._activeContextMenuParent = null;
            this._activeContextMenuItem = null;
        }
    }

    _resizeApplicationsBox() {
        let width = -1;
        Util.each(this.applicationsBox.get_children(), c => {
            let [min, nat] = c.get_preferred_width(-1.0);
            if (nat > width)
                width = nat;
        });
        this.applicationsBox.set_width(width + 42); // The answer to life...
    }


    _displayButtons(appCategory, places, recent, apps, autocompletes, exactMatch){
        // destroy temporary buttons
        Util.each(this._transientButtons, item => item.destroy());
        this._transientButtons = [];
        Util.each(this._searchProviderButtons, item => item.destroy());
        this._searchProviderButtons = [];

        let selectedActor = null;
        if (appCategory) {
            Util.each(this._applicationsButtons, item => { item.actor.visible = appCategory === -1 || item.category.includes(appCategory) });
        } else if (apps) {
            Util.each(this._applicationsButtons, item => {
                let appId = item.app.get_id();
                item.actor.visible = apps.includes(appId);
                if (appId === exactMatch)
                    selectedActor = item.actor;
            });
        } else {
            Util.each(this._applicationsButtons, item => { item.actor.visible = false });
        }

        if (places) {
            Util.each(this._placesButtons, item => {
                item.actor.visible =  places === -1 || places.includes(item.button_name)
                if (!selectedActor && item.button_name === exactMatch)
                    selectedActor = item.actor;
            });
        } else {
            Util.each(this._placesButtons, item => { item.actor.visible = false });
        }

        Util.each(this._recentButtons, item => { item.actor.visible = recent == null ? false : recent === -1 || recent.includes(item.button_name) });

        if (autocompletes) {
            Util.each(autocompletes, item => {
                let button = new TransientButton(this, item);
                button.actor.connect('leave-event', Lang.bind(this, this._appLeaveEvent, button));
                this._addEnterEvent(button, Lang.bind(this, this._appEnterEvent, button));
                this._transientButtons.push(button);
                this.applicationsBox.add_actor(button.actor);
            });
        }

        return selectedActor;
    }

    _setCategoriesButtonActive(active) {
        try {
            let categoriesButtons = this.categoriesBox.get_children();
            for (var i in categoriesButtons) {
                let button = categoriesButtons[i];
                let icon = button._delegate.icon;
                if (active){
                    button.set_style_class_name("menu-category-button");
                    if (icon) {
                        icon.set_opacity(255);
                    }
                } else {
                    button.set_style_class_name("menu-category-button-greyed");
                    if (icon) {
                        let icon_opacity = icon.get_theme_node().get_double('opacity');
                        icon_opacity = Math.min(Math.max(0, icon_opacity), 1);
                        if (icon_opacity) // Don't set opacity to 0 if not defined
                            icon.set_opacity(icon_opacity * 255);
                    }
                }
            }
        } catch (e) {
            global.log(e);
        }
    }

    resetSearch(){
        this.searchEntry.set_text("");
    }

    _onSearchTextChanged (se, prop) {
        if (this.menuIsOpening) {
            this.menuIsOpening = false;
            return;
        } else {
            let searchString = this.searchEntry.get_text();
            if (searchString == '' && !this.searchActive)
                return;
            this.searchActive = searchString != '';
            this._fileFolderAccessActive = this.searchActive && this.searchFilesystem;
            this._clearAllSelections();

            if (this.searchActive) {
                this.searchEntry.set_secondary_icon(this._searchActiveIcon);
                if (this._searchIconClickedId == 0) {
                    this._searchIconClickedId = this.searchEntry.connect('secondary-icon-clicked',
                        Lang.bind(this, function() {
                            this.resetSearch();
                            this._select_category(null);
                        }));
                }
                this._setCategoriesButtonActive(false);
                this.lastSelectedCategory = "search"
                this._doSearch();
            } else {
                if (this._searchIconClickedId > 0)
                    this.searchEntry.disconnect(this._searchIconClickedId);
                this._searchIconClickedId = 0;
                this.searchEntry.set_secondary_icon(this._searchInactiveIcon);
                this._previousSearchPattern = "";
                this._setCategoriesButtonActive(true);
                this._select_category(null);
                this._allAppsCategoryButton.actor.style_class = "menu-category-button-selected";
                this._activeContainer = null;
                this.selectedAppTitle.set_text("");
                this.selectedAppDescription.set_text("");
            }
            return;
        }
    }

    _matchNames(names, pattern){
        let res = [];
        let exactMatch = null;
        for (let id = 0; id < names.length; id++) {
            if (pattern) {
                let name = names[id].name;
                let lowerName = name.toLowerCase();
                if (lowerName.indexOf(pattern) !== -1) res.push(names[id]);
                if (!exactMatch && lowerName === pattern) exactMatch = name;
            } else res.push(names[id]);
        }
        return [res, exactMatch];
    }

    _listBookmarks(pattern){
        return this._matchNames(Main.placesManager.getBookmarks(), pattern);
    }

    _listDevices(pattern){
        return this._matchNames(Main.placesManager.getMounts(), pattern);
    }

    _listApplications(pattern){
        let res = [];
        let exactMatch = null;
        if (pattern){
            res = [];
            let regexpPattern = new RegExp("\\b"+pattern);
            for (let i in this._applicationsButtons) {
                let app = this._applicationsButtons[i].app;
                let latinisedLowerName = Util.latinise(app.get_name().toLowerCase());
                if (latinisedLowerName.match(regexpPattern) !== null) {
                    res.push(app.get_id());
                    if (!exactMatch && latinisedLowerName === pattern)
                        exactMatch = app.get_id();
                }
            }
            if (!exactMatch) {
                for (let i in this._applicationsButtons) {
                    let app = this._applicationsButtons[i].app;
                    if (Util.latinise(app.get_name().toLowerCase()).indexOf(pattern)!==-1 ||
                        (app.get_keywords() && Util.latinise(app.get_keywords().join(" ").toLowerCase()).indexOf(pattern)!==-1) ||
                        (app.get_description() && Util.latinise(app.get_description().toLowerCase()).indexOf(pattern)!==-1) ||
                        (app.get_id() && Util.latinise(app.get_id().slice(0, -8).toLowerCase()).indexOf(pattern)!==-1))
                        res.push(app.get_id());
                }
            }
        }
        return [res, exactMatch];
    }

    _doSearch(){
        this._searchTimeoutId = 0;
        let pattern = this.searchEntryText.get_text().replace(/^\s+/g, '').replace(/\s+$/g, '').toLowerCase();
        pattern = Util.latinise(pattern);
        if (pattern==this._previousSearchPattern) return false;
        this._previousSearchPattern = pattern;
        this._activeContainer = null;
        this._activeActor = null;
        this._selectedItemIndex = null;
        this._previousTreeSelectedActor = null;
        this._previousSelectedActor = null;

        let result = this._listApplications(pattern);
        let appResults = result[0];
        let exactMatch = result[1];
        let placesResults = [];

        result = this._listBookmarks(pattern);
        let bookmarks = result[0];
        exactMatch = exactMatch || result[1];
        for (let i in bookmarks)
            placesResults.push(bookmarks[i].name);

        result = this._listDevices(pattern);
        let devices = result[0];
        exactMatch = exactMatch || result[1];
        for (let i in devices)
            placesResults.push(devices[i].name);

        let recentResults = [];
        for (let i = 0; i < this._recentButtons.length; i++) {
            if (!(this._recentButtons[i] instanceof RecentClearButton) && this._recentButtons[i].button_name.toLowerCase().indexOf(pattern) != -1)
                recentResults.push(this._recentButtons[i].button_name);
        }

        var acResults = []; // search box autocompletion results
        if (this.searchFilesystem) {
            // Don't use the pattern here, as filesystem is case sensitive
            acResults = this._getCompletions(this.searchEntryText.get_text());
        }

        let selectedActor = this._displayButtons(null, placesResults, recentResults, appResults, acResults, exactMatch);

        this.appBoxIter.reloadVisible();
        if (this.appBoxIter.getNumVisibleChildren() > 0) {
            let item_actor = selectedActor || this.appBoxIter.getFirstVisible();
            this._selectedItemIndex = this.appBoxIter.getAbsoluteIndexOfChild(item_actor);
            this._activeContainer = this.applicationsBox;
            this._scrollToButton(item_actor._delegate);
            if (item_actor && item_actor != this.searchEntry) {
                item_actor._delegate.emit('enter-event');
            }
        } else {
            this.selectedAppTitle.set_text("");
            this.selectedAppDescription.set_text("");
        }

        SearchProviderManager.launch_all(pattern, Lang.bind(this, function(provider, results){
            try{
                for (var i in results){
                    if (results[i].type != 'software')
                    {
                        let button = new SearchProviderResultButton(this, provider, results[i]);
                        button.actor.connect('leave-event', Lang.bind(this, this._appLeaveEvent, button));
                        this._addEnterEvent(button, Lang.bind(this, this._appEnterEvent, button));
                        this._searchProviderButtons.push(button);
                        this.applicationsBox.add_actor(button.actor);
                        if (this._selectedItemIndex === null) {
                            this.appBoxIter.reloadVisible();
                            let item_actor = this.appBoxIter.getFirstVisible();
                            this._selectedItemIndex = this.appBoxIter.getAbsoluteIndexOfChild(item_actor);
                            this._activeContainer = this.applicationsBox;
                            if (item_actor && item_actor != this.searchEntry) {
                                item_actor._delegate.emit('enter-event');
                            }
                        }
                    }
                }
            }catch(e){global.log(e);}
        }));

        return false;
    }

    _getCompletion (text) {
        if (text.indexOf('/') != -1) {
            if (text.substr(text.length - 1) == '/') {
                return '';
            } else {
                return this._pathCompleter.get_completion_suffix(text);
            }
        } else {
            return false;
        }
    }

    _getCompletions (text) {
        if (text.indexOf('/') != -1) {
            return this._pathCompleter.get_completions(text);
        } else {
            return [];
        }
    }

    _run (input) {
        this._commandError = false;
        if (input) {
            let path = null;
            if (input.charAt(0) == '/') {
                path = input;
            } else {
                if (input.charAt(0) == '~')
                    input = input.slice(1);
                path = GLib.get_home_dir() + '/' + input;
            }

            if (GLib.file_test(path, GLib.FileTest.EXISTS)) {
                let file = Gio.file_new_for_path(path);
                try {
                    Gio.app_info_launch_default_for_uri(file.get_uri(),
                                                        global.create_app_launch_context());
                } catch (e) {
                    // The exception from gjs contains an error string like:
                    //     Error invoking Gio.app_info_launch_default_for_uri: No application
                    //     is registered as handling this file
                    // We are only interested in the part after the first colon.
                    //let message = e.message.replace(/[^:]*: *(.+)/, '$1');
                    return false;
                }
            } else {
                return false;
            }
        }

        return true;
    }
};

function main(metadata, orientation, panel_height, instance_id) {
    return new CinnamonMenuApplet(orientation, panel_height, instance_id);
}
