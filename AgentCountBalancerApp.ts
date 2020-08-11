import {
    HttpStatusCode,
    IAppAccessors,
    IConfigurationExtend,
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

    public async executePostLivechatRoomStarted(room: ILivechatRoom, read: IRead, http: IHttp, persistence: IPersistence): Promise<void> {

        const authToken = await read.getEnvironmentReader().getSettings().getValueById('admin_token');
        const adminId = await read.getEnvironmentReader().getSettings().getValueById('admin_id');
        const baseUrl: string = await read.getEnvironmentReader().getServerSettings().getValueById('Site_Url');

        const reqOptions =  {
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
        const onlineAgents: Array<any> = [];
        const offlineAgents: Array<any> = [];
        await Promise.all(agents.map( async (agent) => {
            res = await http.get(`${baseUrl}/api/v1/livechat/users/agent/${agent.agentId}`, reqOptions);
            if (res.statusCode !== HttpStatusCode.OK || res.data.success !== true) {
                this.getLogger().error('Failed to get agent info: ', res);
                return;
            }
            if (res.data.user.statusLivechat === 'available') {
                onlineAgents.push(agent);
            } else {
                offlineAgents.push(agent);
            }
        }));

        const hasMoreThanOne = onlineAgents.find( (agent) => agent.count > 1);
        const everyoneHasOne = onlineAgents.every( (agent) => agent.count >= 1);
        if (hasMoreThanOne || everyoneHasOne) {
            onlineAgents.map( (agent, index) => {
                agent.count = 0;
            });
            const reqOptionsForPut = reqOptions;
            const allAgents = onlineAgents.concat(offlineAgents);
            reqOptionsForPut.data = {department, agents: allAgents };
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
    }

}
