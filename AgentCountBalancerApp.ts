import {
    HttpStatusCode,
    IAppAccessors,
    IConfigurationExtend,
    IEnvironmentRead,
    IHttp,
    ILogger,
    IPersistence,
    IRead,
} from '@rocket.chat/apps-engine/definition/accessors';
import { App } from '@rocket.chat/apps-engine/definition/App';
import { ILivechatRoom, IPostLivechatRoomStarted } from '@rocket.chat/apps-engine/definition/livechat';
import { IAppInfo } from '@rocket.chat/apps-engine/definition/metadata';
import { SettingType } from '@rocket.chat/apps-engine/definition/settings';

export class AgentCountBalancerApp extends App implements IPostLivechatRoomStarted {
    constructor(info: IAppInfo, logger: ILogger, accessors: IAppAccessors) {
        super(info, logger, accessors);

    }

    public async initialize(configurationExtend: IConfigurationExtend, environmentRead: IEnvironmentRead): Promise<void> {
        await this.extendConfiguration(configurationExtend);
    }

    public async executePostLivechatRoomStarted(room: ILivechatRoom, read: IRead, http: IHttp, persistence: IPersistence): Promise<void> {

        const authToken = await read.getEnvironmentReader().getSettings().getValueById('admin_token');
        const adminId = await read.getEnvironmentReader().getSettings().getValueById('admin_id');
        const baseUrl: string = await read.getEnvironmentReader().getServerSettings().getValueById('Site_Url');

        const reqOptions = {
            headers: {
                'X-Auth-Token': authToken,
                'X-User-Id': adminId,
            },
            data: {},
        };

        const depId = room.department!.id;
        let res = await http.get(`${baseUrl}/api/v1/livechat/department/${depId}`, reqOptions);
        if (res.statusCode !== HttpStatusCode.OK || res.data.success !== true) {
            this.getLogger().error('Failed to get department info: ', res);
            return;
        }
        const agents = res.data.agents;
        const department = res.data.department;
        const availableAgents: Array<any> = [];
        const unavailableAgents: Array<any> = [];
        await Promise.all(agents.map(async (agent) => {
            res = await http.get(`${baseUrl}/api/v1/livechat/users/agent/${agent.agentId}`, reqOptions);
            if (res.statusCode !== HttpStatusCode.OK || res.data.success !== true) {
                this.getLogger().error('Failed to get agent info: ', res);
                return;
            }

            const acceptAway = await read.getEnvironmentReader().getServerSettings().getValueById('Livechat_enabled_when_agent_idle');

            if (res.data.user.statusLivechat === 'available' && (res.data.user.status === 'online' || (acceptAway && res.data.user.status === 'away'))) {
                availableAgents.push({ ...agent, status: res.data.user.status });
            } else {
                unavailableAgents.push({ ...agent, status: res.data.user.status });
            }
        }));

        const hasMoreThanOne = availableAgents.find((agent) => agent.count > 1);
        const everyoneHasOne = availableAgents.every((agent) => agent.count >= 1);

        const shouldLog = await read.getEnvironmentReader().getSettings().getValueById('log_setting');
        if (shouldLog) {
            this.getLogger().log(`New visitor entering department: ${department.name}`);
            this.getLogger().log(`Online agents: `, availableAgents);
            this.getLogger().log(`Offline agents: `, unavailableAgents);
            this.getLogger().log(`HasMoreThanOne: `, hasMoreThanOne);
            this.getLogger().log(`EveryOneHasOne: `, everyoneHasOne);
        }
        if (hasMoreThanOne || everyoneHasOne) {
            this.getLogger().log('Going to reset everyone from department: ', department.name);
            availableAgents.map((agent, index) => {
                agent.count = 0;
            });
            const reqOptionsForPut = reqOptions;
            const allAgents = availableAgents.concat(unavailableAgents);
            reqOptionsForPut.data = { department, agents: allAgents };
            res = await http.put(`${baseUrl}/api/v1/livechat/department/${depId}`, reqOptionsForPut);
            if (res.statusCode !== HttpStatusCode.OK || res.data.success !== true) {
                this.getLogger().error('Failed to update agents count value: ', res);
                return;
            }
        }

    }

    public async extendConfiguration(configuration: IConfigurationExtend): Promise<void> {

        await configuration.settings.provideSetting({
            id: 'admin_token',
            type: SettingType.STRING,
            packageValue: '',
            required: true,
            public: false,
            i18nLabel: 'Token de Autenticação',
        });

        await configuration.settings.provideSetting({
            id: 'admin_id',
            type: SettingType.STRING,
            packageValue: '',
            required: true,
            public: false,
            i18nLabel: 'ID de Usuário',
        });

        await configuration.settings.provideSetting({
            id: 'log_setting',
            type: SettingType.BOOLEAN,
            packageValue: '',
            required: false,
            public: false,
            i18nLabel: 'Logs',
        });
    }

}
